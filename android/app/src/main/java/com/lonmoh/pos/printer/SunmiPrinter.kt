package com.lonmoh.pos.printer

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.util.Log
import woyou.aidlservice.jiuiv5.ICallback
import woyou.aidlservice.jiuiv5.IWoyouService
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Binds the built-in printer service on SUNMI POS terminals.
 *
 * SUNMI exposes the internal printer through an AIDL service rather than a socket,
 * so the same ESC/POS bytes the LAN path writes to port 9100 are handed to
 * [IWoyouService.sendRAWData] here. Composition stays in TypeScript; this is transport.
 *
 * On non-SUNMI hardware the bind simply never succeeds and [isAvailable] stays false —
 * the app falls back to the network driver.
 */
class SunmiPrinter(private val context: Context) {

    companion object {
        private const val TAG = "SunmiPrinter"
        private const val SERVICE_PACKAGE = "woyou.aidlservice.jiuiv5"
        private const val SERVICE_ACTION = "woyou.aidlservice.jiuiv5.IWoyouService"

        /** SUNMI reports completion asynchronously; don't hang the caller forever. */
        private const val RESULT_TIMEOUT_MS = 15_000L
    }

    interface Result {
        fun ok()
        fun fail(message: String)
    }

    private var service: IWoyouService? = null

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            service = IWoyouService.Stub.asInterface(binder)
            Log.i(TAG, "SUNMI printer service connected")
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            service = null
            Log.w(TAG, "SUNMI printer service disconnected")
        }
    }

    fun connect() {
        if (service != null) return
        try {
            val intent = Intent().apply {
                setPackage(SERVICE_PACKAGE)
                action = SERVICE_ACTION
            }
            val bound = context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
            if (!bound) Log.i(TAG, "No SUNMI printer service on this device")
        } catch (e: Exception) {
            // Expected on tablets and emulators — not an error worth surfacing.
            Log.i(TAG, "SUNMI printer service unavailable: ${e.message}")
        }
    }

    fun disconnect() {
        if (service == null) return
        try {
            context.unbindService(connection)
        } catch (e: IllegalArgumentException) {
            // Already unbound.
        }
        service = null
    }

    fun isAvailable(): Boolean = service != null

    /**
     * Write raw ESC/POS to the internal printer.
     *
     * [callback] fires exactly once: on the service's success signal, on its exception
     * signal, or on timeout if the service goes quiet mid-print.
     */
    fun sendRaw(data: ByteArray, callback: Result) {
        val printer = service
        if (printer == null) {
            callback.fail("No SUNMI printer service bound on this device")
            return
        }

        val settled = AtomicBoolean(false)
        fun settle(action: () -> Unit) {
            if (settled.compareAndSet(false, true)) action()
        }

        val timeout = Runnable {
            settle { callback.fail("SUNMI printer did not report a result in ${RESULT_TIMEOUT_MS}ms") }
        }
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        handler.postDelayed(timeout, RESULT_TIMEOUT_MS)

        val aidlCallback = object : ICallback.Stub() {
            override fun onRunResult(isSuccess: Boolean) {
                handler.removeCallbacks(timeout)
                settle { if (isSuccess) callback.ok() else callback.fail("Printer reported failure") }
            }

            override fun onReturnString(result: String?) {
                // Only used by the query methods; a print never settles on this.
            }

            override fun onRaiseException(code: Int, msg: String?) {
                handler.removeCallbacks(timeout)
                settle { callback.fail("Printer exception $code: ${msg ?: "unknown"}") }
            }

            override fun onPrintResult(code: Int, msg: String?) {
                handler.removeCallbacks(timeout)
                settle { if (code == 0) callback.ok() else callback.fail("Print result $code: ${msg ?: "unknown"}") }
            }
        }

        try {
            printer.sendRAWData(data, aidlCallback)
        } catch (e: Exception) {
            handler.removeCallbacks(timeout)
            settle { callback.fail(e.message ?: e.toString()) }
        }
    }
}
