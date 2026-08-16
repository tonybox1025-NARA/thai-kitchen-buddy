package com.lonmoh.pos.printer

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Log

/**
 * ESC/POS over USB, for a receipt printer cabled straight to the tablet.
 *
 * Same bytes as the LAN and SUNMI paths — only the transport differs. Prefer the
 * network driver where the printer has an ethernet port: USB ties printing to the one
 * tablet holding the cable, needs USB-OTG, and needs the user to grant per-device
 * permission. This exists for printers with no usable LAN port.
 *
 * NOT VERIFIED AGAINST REAL HARDWARE — no USB printer was available when this was
 * written, and the emulator cannot host USB. Treat the first run on a real printer as
 * the actual test.
 */
class UsbPrinter(private val context: Context) {

    companion object {
        private const val TAG = "UsbPrinter"
        private const val ACTION_USB_PERMISSION = "com.lonmoh.pos.USB_PERMISSION"

        /** bulkTransfer is capped in practice; send in chunks well under the limit. */
        private const val CHUNK_BYTES = 4096
        private const val TRANSFER_TIMEOUT_MS = 5000
    }

    interface Result {
        fun ok(bytes: Int, deviceName: String)
        fun fail(message: String)
    }

    data class DeviceInfo(
        val deviceId: Int,
        val vendorId: Int,
        val productId: Int,
        val name: String,
        val product: String?,
        val isPrinterClass: Boolean,
    )

    private val usbManager: UsbManager?
        get() = context.getSystemService(Context.USB_SERVICE) as? UsbManager

    /** Everything currently attached, printer-class devices first. */
    fun listDevices(): List<DeviceInfo> {
        val manager = usbManager ?: return emptyList()
        return manager.deviceList.values
            .map { device ->
                DeviceInfo(
                    deviceId = device.deviceId,
                    vendorId = device.vendorId,
                    productId = device.productId,
                    name = device.deviceName,
                    product = runCatching { device.productName }.getOrNull(),
                    isPrinterClass = findPrinterInterface(device) != null,
                )
            }
            .sortedByDescending { it.isPrinterClass }
    }

    /**
     * Send raw ESC/POS to [deviceId], or to the first printer-class device when null.
     * Requests USB permission first if it has not been granted for that device.
     */
    fun print(data: ByteArray, deviceId: Int?, callback: Result) {
        val manager = usbManager
        if (manager == null) {
            callback.fail("This device has no USB host support")
            return
        }

        val device = pickDevice(manager, deviceId)
        if (device == null) {
            val attached = manager.deviceList.size
            callback.fail(
                if (attached == 0) "No USB device attached — check the cable and that the tablet supports USB-OTG"
                else "No USB printer found among $attached attached device(s)",
            )
            return
        }

        if (manager.hasPermission(device)) {
            writeToDevice(manager, device, data, callback)
            return
        }

        requestPermission(manager, device) { granted ->
            if (granted) writeToDevice(manager, device, data, callback)
            else callback.fail("USB permission denied for ${device.deviceName}")
        }
    }

    private fun pickDevice(manager: UsbManager, deviceId: Int?): UsbDevice? {
        val devices = manager.deviceList.values
        if (deviceId != null) return devices.firstOrNull { it.deviceId == deviceId }
        return devices.firstOrNull { findPrinterInterface(it) != null }
            ?: devices.firstOrNull { findBulkOutInterface(it) != null }
    }

    /** Interface advertising the USB printer class (7). */
    private fun findPrinterInterface(device: UsbDevice): UsbInterface? {
        for (i in 0 until device.interfaceCount) {
            val intf = device.getInterface(i)
            if (intf.interfaceClass == UsbConstants.USB_CLASS_PRINTER && bulkOutOf(intf) != null) {
                return intf
            }
        }
        return null
    }

    /** Fallback: some thermal printers expose a vendor-specific interface instead of class 7. */
    private fun findBulkOutInterface(device: UsbDevice): UsbInterface? {
        for (i in 0 until device.interfaceCount) {
            val intf = device.getInterface(i)
            if (bulkOutOf(intf) != null) return intf
        }
        return null
    }

    private fun bulkOutOf(intf: UsbInterface): UsbEndpoint? {
        for (e in 0 until intf.endpointCount) {
            val ep = intf.getEndpoint(e)
            if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK &&
                ep.direction == UsbConstants.USB_DIR_OUT
            ) {
                return ep
            }
        }
        return null
    }

    private fun requestPermission(
        manager: UsbManager,
        device: UsbDevice,
        onResult: (Boolean) -> Unit,
    ) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action != ACTION_USB_PERMISSION) return
                runCatching { context.unregisterReceiver(this) }
                val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                onResult(granted)
            }
        }

        val filter = IntentFilter(ACTION_USB_PERMISSION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }

        // Must be explicit (setPackage) and immutable for Android 12+.
        val intent = Intent(ACTION_USB_PERMISSION).setPackage(context.packageName)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        manager.requestPermission(device, PendingIntent.getBroadcast(context, 0, intent, flags))
    }

    private fun writeToDevice(
        manager: UsbManager,
        device: UsbDevice,
        data: ByteArray,
        callback: Result,
    ) {
        val intf = findPrinterInterface(device) ?: findBulkOutInterface(device)
        if (intf == null) {
            callback.fail("USB device ${device.deviceName} has no bulk OUT endpoint to print to")
            return
        }
        val endpoint = bulkOutOf(intf)
        if (endpoint == null) {
            callback.fail("No bulk OUT endpoint on the selected USB interface")
            return
        }

        var connection: UsbDeviceConnection? = null
        var claimed = false
        try {
            connection = manager.openDevice(device)
            if (connection == null) {
                callback.fail("Could not open USB device ${device.deviceName}")
                return
            }
            claimed = connection.claimInterface(intf, true)
            if (!claimed) {
                callback.fail("Another app is holding the USB printer — close it and retry")
                return
            }

            var sent = 0
            while (sent < data.size) {
                val len = minOf(CHUNK_BYTES, data.size - sent)
                val wrote = connection.bulkTransfer(endpoint, data, sent, len, TRANSFER_TIMEOUT_MS)
                if (wrote < 0) {
                    callback.fail("USB write failed after $sent of ${data.size} bytes")
                    return
                }
                sent += wrote
                // A short write is legal; loop again from the new offset.
                if (wrote == 0) {
                    callback.fail("USB write stalled at $sent of ${data.size} bytes")
                    return
                }
            }

            Log.i(TAG, "Printed $sent bytes to ${device.deviceName}")
            callback.ok(sent, device.productName ?: device.deviceName)
        } catch (e: Exception) {
            callback.fail(e.message ?: e.toString())
        } finally {
            if (claimed) runCatching { connection?.releaseInterface(intf) }
            runCatching { connection?.close() }
        }
    }
}
