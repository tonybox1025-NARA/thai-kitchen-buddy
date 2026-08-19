package com.lonmoh.pos

import android.content.res.Configuration
import android.content.res.Resources
import android.os.Bundle
import android.view.WindowManager
import com.getcapacitor.BridgeActivity
import com.lonmoh.pos.printer.PosPrinterPlugin

class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        // Must be registered before super.onCreate() — that is where the bridge
        // is built and the plugin list is frozen.
        registerPlugin(PosPrinterPlugin::class.java)
        super.onCreate(savedInstanceState)

        // A till screen that sleeps mid-order is worse than a slightly hot tablet.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    // SUNMI / rugged POS devices register a phantom hardware keyboard (their
    // function keys report as a KEYBOARD-class input device). Chromium WebView
    // then treats the till as having a real keyboard and suppresses the on-screen
    // keyboard when a field is focused — you tap an input, it gets the focus ring,
    // but no keyboard appears. Report "no hardware keyboard" so the soft keyboard
    // shows on tap. The guard makes this a no-op once patched (and avoids an
    // updateConfiguration recursion). Harmless on real tablets/emulators, and the
    // always-on-screen keyboard is the right behaviour for a POS anyway.
    override fun getResources(): Resources {
        val res = super.getResources()
        val config = res.configuration
        if (config.keyboard != Configuration.KEYBOARD_NOKEYS) {
            config.keyboard = Configuration.KEYBOARD_NOKEYS
            config.hardKeyboardHidden = Configuration.HARDKEYBOARDHIDDEN_YES
            @Suppress("DEPRECATION")
            res.updateConfiguration(config, res.displayMetrics)
        }
        return res
    }
}
