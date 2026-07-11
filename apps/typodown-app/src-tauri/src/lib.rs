use std::sync::Mutex;
use tauri::Manager;

/// File the OS asked us to open (file association / VIEW intent), waiting for
/// the frontend to pick it up. The frontend may not be loaded yet when the OS
/// delivers it, so we stash it here and expose it via a command; we also emit
/// an `open-file` event for the warm-start case (app already running).
struct PendingOpenFile(Mutex<Option<String>>);

#[tauri::command]
fn take_pending_open_file(state: tauri::State<'_, PendingOpenFile>) -> Option<String> {
    state.0.lock().unwrap().take()
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
        .invoke_handler(tauri::generate_handler![take_pending_open_file])
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
