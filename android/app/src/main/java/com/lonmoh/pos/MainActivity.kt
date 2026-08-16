package com.lonmoh.pos

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
}
