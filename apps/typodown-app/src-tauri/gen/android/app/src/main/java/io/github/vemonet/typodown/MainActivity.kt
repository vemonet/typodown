package io.github.vemonet.typodown

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Pad the native content view for the navigation bar, keyboard and side
    // cutouts, but NOT for the status bar (top): the WebView draws full-bleed
    // to the top of the screen so the app background reaches the notification
    // bar, and the web layer offsets its content below it with
    // env(safe-area-inset-top). The insets are returned (not consumed) so the
    // WebView still receives them and exposes env(safe-area-inset-*) to CSS.
    val content = findViewById<android.view.View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars()
          or WindowInsetsCompat.Type.displayCutout()
          or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(bars.left, 0, bars.right, bars.bottom)
      insets
    }
  }
}
