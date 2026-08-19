package com.lonmoh.pos.printer

import android.content.Context
import android.util.Base64
import android.view.inputmethod.InputMethodManager
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.Executors

/**
 * Raw ESC/POS transport for the POS app.
 *
 * JavaScript composes the ESC/POS byte stream (src/lib/print/escpos.ts) and passes it
 * here as base64; this plugin only moves bytes. Receipt layout therefore lives in one
 * place, shared with the Node bridge the restaurant runs today, and the native surface
 * stays small enough to audit.
 *
 * Replaces scripts/print-bridge.js for LAN printers: no companion machine has to sit
 * awake next to the till relaying jobs.
 */
@CapacitorPlugin(name = "PosPrinter")
class PosPrinterPlugin : Plugin() {

    private companion object {
        const val DEFAULT_PORT = 9100
        const val DEFAULT_TIMEOUT_MS = 5000
        const val DEFAULT_PROBE_TIMEOUT_MS = 2000
    }

    /** Sockets block — keep them off the WebView thread. */
    private val io = Executors.newSingleThreadExecutor()

    private lateinit var sunmi: SunmiPrinter
    private lateinit var usb: UsbPrinter

    override fun load() {
        sunmi = SunmiPrinter(context)
        sunmi.connect()
        usb = UsbPrinter(context)
    }

    override fun handleOnDestroy() {
        sunmi.disconnect()
        io.shutdownNow()
    }

    /**
     * Send ESC/POS bytes to a network printer over raw TCP (JetDirect, port 9100).
     * Params: host, port?, data (base64), timeoutMs?
     */
    @PluginMethod
    fun printTcp(call: PluginCall) {
        val host = call.getString("host")?.trim()
        if (host.isNullOrEmpty()) {
            call.reject("Printer host is not set")
            return
        }
        val port = call.getInt("port", DEFAULT_PORT)!!
        val timeoutMs = call.getInt("timeoutMs", DEFAULT_TIMEOUT_MS)!!
        val payload = call.decodeData() ?: return

        io.execute {
            try {
                Socket().use { socket ->
                    socket.connect(InetSocketAddress(host, port), timeoutMs)
                    socket.soTimeout = timeoutMs
                    socket.getOutputStream().apply {
                        write(payload)
                        flush()
                    }
                }
                call.resolve(
                    JSObject()
                        .put("bytes", payload.size)
                        .put("target", "$host:$port"),
                )
            } catch (e: Exception) {
                call.reject("Print to $host:$port failed: ${e.message}", e)
            }
        }
    }

    /**
     * Check that a printer answers on host/port without printing anything.
     * Resolves either way — an unreachable printer is a status, not a call failure.
     * Params: host, port?, timeoutMs?
     */
    @PluginMethod
    fun probeTcp(call: PluginCall) {
        val host = call.getString("host")?.trim()
        if (host.isNullOrEmpty()) {
            call.reject("Printer host is not set")
            return
        }
        val port = call.getInt("port", DEFAULT_PORT)!!
        val timeoutMs = call.getInt("timeoutMs", DEFAULT_PROBE_TIMEOUT_MS)!!

        io.execute {
            val started = System.currentTimeMillis()
            try {
                Socket().use { it.connect(InetSocketAddress(host, port), timeoutMs) }
                call.resolve(
                    JSObject()
                        .put("reachable", true)
                        .put("latencyMs", System.currentTimeMillis() - started),
                )
            } catch (e: Exception) {
                call.resolve(
                    JSObject()
                        .put("reachable", false)
                        .put("error", e.message ?: e.toString()),
                )
            }
        }
    }

    /**
     * Send ESC/POS bytes to the built-in printer on a SUNMI POS terminal.
     * Params: data (base64)
     */
    @PluginMethod
    fun printSunmi(call: PluginCall) {
        val payload = call.decodeData() ?: return

        sunmi.sendRaw(
            payload,
            object : SunmiPrinter.Result {
                override fun ok() {
                    call.resolve(
                        JSObject()
                            .put("bytes", payload.size)
                            .put("target", "sunmi"),
                    )
                }

                override fun fail(message: String) {
                    call.reject("SUNMI print failed: $message")
                }
            },
        )
    }

    /** Whether this device has a bound SUNMI printer service. */
    @PluginMethod
    fun sunmiStatus(call: PluginCall) {
        call.resolve(JSObject().put("available", sunmi.isAvailable()))
    }

    /**
     * Send ESC/POS bytes to a USB-attached printer.
     * Params: data (base64), deviceId? (from usbDevices; omit to auto-pick the printer)
     */
    @PluginMethod
    fun printUsb(call: PluginCall) {
        val payload = call.decodeData() ?: return
        val deviceId = if (call.hasOption("deviceId")) call.getInt("deviceId") else null

        usb.print(
            payload,
            deviceId,
            object : UsbPrinter.Result {
                override fun ok(bytes: Int, deviceName: String) {
                    call.resolve(
                        JSObject()
                            .put("bytes", bytes)
                            .put("target", "usb:$deviceName"),
                    )
                }

                override fun fail(message: String) {
                    call.reject("USB print failed: $message")
                }
            },
        )
    }

    /** List attached USB devices so the till can be pointed at the right one. */
    @PluginMethod
    fun usbDevices(call: PluginCall) {
        val devices = JSArray()
        for (d in usb.listDevices()) {
            devices.put(
                JSObject()
                    .put("deviceId", d.deviceId)
                    .put("vendorId", d.vendorId)
                    .put("productId", d.productId)
                    .put("name", d.name)
                    .put("product", d.product)
                    .put("isPrinterClass", d.isPrinterClass),
            )
        }
        call.resolve(JSObject().put("devices", devices))
    }

    /**
     * Force the on-screen keyboard to show for the WebView. SUNMI / rugged POS
     * devices register a phantom hardware keyboard, so Chromium WebView never asks
     * for the soft keyboard when a field is focused (the field gets the focus ring
     * but no keyboard). The web layer calls this on focusin of a real text field.
     */
    @PluginMethod
    fun showKeyboard(call: PluginCall) {
        activity?.runOnUiThread {
            val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            @Suppress("DEPRECATION")
            imm.showSoftInput(bridge.webView, InputMethodManager.SHOW_FORCED)
        }
        call.resolve()
    }

    /** Hide the on-screen keyboard (called on focusout of a text field). */
    @PluginMethod
    fun hideKeyboard(call: PluginCall) {
        activity?.runOnUiThread {
            val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.hideSoftInputFromWindow(bridge.webView.windowToken, 0)
        }
        call.resolve()
    }

    /** Decode the base64 payload, rejecting the call and returning null if it is unusable. */
    private fun PluginCall.decodeData(): ByteArray? {
        val encoded = getString("data")
        if (encoded == null) {
            reject("Missing data")
            return null
        }
        return try {
            Base64.decode(encoded, Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            reject("data is not valid base64", e)
            null
        }
    }
}
