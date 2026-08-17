use std::sync::Mutex;
use tauri::Manager;

/// HTML waiting to be picked up by the export webview.
///
/// The print window cannot be handed its content directly: `WebviewUrl` only
/// takes a URL, and neither `data:` (blocked by WKWebView for top-level loads)
/// nor `file://` (outside the app's origin, so the asset protocol images resolve
/// to would not load) works. So the document is stashed here and served by the
/// `tdexport:` scheme handler registered in `run()`, which keeps the whole thing
/// inside the app's own context.
struct PendingExport(Mutex<Option<String>>);

/// Render an already-built HTML document in a separate window and open the OS
/// print dialog on it, which is where "Save as PDF" lives.
///
/// Printing is driven from Rust rather than `window.print()` in JS: on macOS
/// only the native `NSPrintOperation` path works (wry runs it through
/// `runOperationModalForWindow`), and going through `Webview::print()` gets the
/// right mechanism on all three desktop platforms.
#[cfg(desktop)]
#[tauri::command]
async fn export_pdf(app: tauri::AppHandle, html: String, title: String) -> Result<(), String> {
    app.state::<PendingExport>().0.lock().unwrap().replace(html);

    // A unique label per export so a second export while the first window is
    // still open does not collide.
    let label = format!(
        "export-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );

    // A custom scheme is addressed differently per platform: `scheme://localhost`
    // on macOS and Linux, `http://scheme.localhost` on Windows.
    #[cfg(windows)]
    let url = "http://tdexport.localhost/";
    #[cfg(not(windows))]
    let url = "tdexport://localhost/";

    tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::External(url.parse().map_err(|_| "bad export url".to_string())?),
    )
    .title(format!("Print {title}"))
    .inner_size(900.0, 1000.0)
    .on_page_load(|window, payload| {
        // Print once the document has actually rendered; printing a blank
        // webview is the classic failure here. The window stays open behind the
        // dialog so the user can re-print or check the layout, and closing it is
        // how they dismiss the export.
        if payload.event() == tauri::webview::PageLoadEvent::Finished {
            if let Err(error) = window.print() {
                eprintln!("failed to open the print dialog: {error}");
            }
        }
    })
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Mobile has no print dialog and no second window to open one in; the stub only
/// exists so `generate_handler!` compiles for Android and iOS.
#[cfg(not(desktop))]
#[tauri::command]
async fn export_pdf(
    _app: tauri::AppHandle,
    _html: String,
    _title: String,
) -> Result<(), String> {
    Err("exporting to PDF is only available on desktop".into())
}

/// File the OS asked us to open (file association / VIEW intent), waiting for
/// the frontend to pick it up. The frontend may not be loaded yet when the OS
/// delivers it, so we stash it here and expose it via a command; we also emit
/// an `open-file` event for the warm-start case (app already running).
struct PendingOpenFile(Mutex<Option<String>>);

#[tauri::command]
fn take_pending_open_file(state: tauri::State<'_, PendingOpenFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// Start a native window drag from a mousedown in the webview.
///
/// Tauri's built-in `start_dragging` hands `NSApp.currentEvent` to
/// `performWindowDragWithEvent:`, but the IPC arrives asynchronously so the
/// "current" event is usually a later mouse-dragged / system event by then —
/// which macOS 26 (Tahoe) silently rejects. This command synthesizes a proper
/// left-mouse-down event at the cursor position instead, which the drag API
/// accepts on every macOS version.
#[cfg(target_os = "macos")]
#[tauri::command]
fn start_native_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    let w = window.clone();
    window
        .run_on_main_thread(move || unsafe {
            use objc2::runtime::AnyObject;
            use objc2::{class, msg_send};
            use objc2_foundation::NSPoint;

            let Ok(ns_window_ptr) = w.ns_window() else {
                return;
            };
            let ns_window = ns_window_ptr as *mut AnyObject;
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let mut event: *mut AnyObject = msg_send![app, currentEvent];
            let ev_type: usize = if event.is_null() {
                0
            } else {
                msg_send![event, type]
            };
            // 1 = NSEventTypeLeftMouseDown; anything else gets replaced by a
            // synthesized left-mouse-down at the current cursor position.
            if ev_type != 1 {
                let screen_point: NSPoint = msg_send![class!(NSEvent), mouseLocation];
                let win_point: NSPoint =
                    msg_send![ns_window, convertPointFromScreen: screen_point];
                let win_num: isize = msg_send![ns_window, windowNumber];
                let ts: f64 = if event.is_null() {
                    0.0
                } else {
                    msg_send![event, timestamp]
                };
                event = msg_send![class!(NSEvent),
                    mouseEventWithType: 1usize,
                    location: win_point,
                    modifierFlags: 0usize,
                    timestamp: ts,
                    windowNumber: win_num,
                    context: std::ptr::null_mut::<AnyObject>(),
                    eventNumber: 0isize,
                    clickCount: 1isize,
                    pressure: 1.0f32,
                ];
            }
            if !event.is_null() {
                let _: () = msg_send![ns_window, performWindowDragWithEvent: event];
            }
        })
        .map_err(|e| e.to_string())
}

/// Non-macOS platforms use tauri's built-in dragging (data-tauri-drag-region),
/// which works there; this stub only exists so the command is always defined.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn start_native_drag(_window: tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

/// Put a *file* (not its path as text) on the system clipboard, so it can be
/// pasted into Finder / Explorer / the VS Code file tree. There is no
/// cross-platform API for file clipboards, so each desktop OS gets its native
/// mechanism.
#[tauri::command]
fn copy_file_to_clipboard(path: String) -> Result<(), String> {
    copy_file_impl(&path)
}

#[cfg(target_os = "macos")]
fn copy_file_impl(path: &str) -> Result<(), String> {
    let script = format!(
        "set the clipboard to (POSIX file \"{}\")",
        path.replace('\\', "\\\\").replace('"', "\\\"")
    );
    run_ok(std::process::Command::new("osascript").args(["-e", &script]))
}

#[cfg(target_os = "windows")]
fn copy_file_impl(path: &str) -> Result<(), String> {
    // The path travels via an env var to avoid quoting pitfalls.
    run_ok(
        std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Set-Clipboard -LiteralPath $env:TD_COPY_PATH",
            ])
            .env("TD_COPY_PATH", path),
    )
}

#[cfg(target_os = "linux")]
fn copy_file_impl(path: &str) -> Result<(), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let uri = tauri::Url::from_file_path(path)
        .map_err(|_| format!("not an absolute path: {path}"))?
        .to_string();
    // text/uri-list is what file managers read on paste. Try the Wayland
    // clipboard tool first, then the X11 one.
    let attempts: [(&str, &[&str]); 2] = [
        ("wl-copy", &["--type", "text/uri-list"]),
        ("xclip", &["-selection", "clipboard", "-t", "text/uri-list"]),
    ];
    for (cmd, args) in attempts {
        let child = Command::new(cmd).args(args).stdin(Stdio::piped()).spawn();
        if let Ok(mut child) = child {
            if let Some(stdin) = child.stdin.as_mut() {
                let _ = stdin.write_all(uri.as_bytes());
            }
            if child.wait().map(|s| s.success()).unwrap_or(false) {
                return Ok(());
            }
        }
    }
    Err("copying files to the clipboard needs wl-copy or xclip installed".into())
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn copy_file_impl(_path: &str) -> Result<(), String> {
    Err("copying files to the clipboard is not supported on this platform".into())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn run_ok(cmd: &mut std::process::Command) -> Result<(), String> {
    let output = cmd.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
fn handle_opened(app: &tauri::AppHandle, urls: &[tauri::Url]) {
    use tauri::Emitter;
    let Some(url) = urls.first() else { return };
    // file:// URLs become plain paths; content:// URIs (Android) are passed
    // through as-is since the fs plugin reads them via the ContentResolver.
    let target = if url.scheme() == "file" {
        url.to_file_path()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| url.to_string())
    } else {
        url.to_string()
    };
    app.state::<PendingOpenFile>()
        .0
        .lock()
        .unwrap()
        .replace(target.clone());
    let _ = app.emit("open-file", target);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PendingOpenFile(Mutex::new(None)))
        .manage(PendingExport(Mutex::new(None)))
        // Serves the document staged by `export_pdf` to the print window. Takes
        // the HTML rather than cloning it: one window, one load, one document.
        .register_uri_scheme_protocol("tdexport", |ctx, _request| {
            let html = ctx
                .app_handle()
                .state::<PendingExport>()
                .0
                .lock()
                .unwrap()
                .take()
                .unwrap_or_else(|| "<!doctype html><p>Nothing to export.".to_string());
            tauri::http::Response::builder()
                .header("Content-Type", "text/html; charset=utf-8")
                .body(html.into_bytes())
                .unwrap()
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_open_file,
            copy_file_to_clipboard,
            start_native_drag,
            export_pdf
        ])
        .setup(|_app| {
            // On Windows and Linux, file associations pass the file as a CLI
            // argument instead of an Opened event.
            #[cfg(any(windows, target_os = "linux"))]
            if let Some(arg) = std::env::args().nth(1) {
                if std::path::Path::new(&arg).is_file() {
                    _app.state::<PendingOpenFile>().0.lock().unwrap().replace(arg);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let tauri::RunEvent::Opened { urls } = &_event {
                handle_opened(_app, urls);
            }
        });
}
