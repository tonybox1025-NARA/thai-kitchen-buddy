// SUNMI inner-printer service interface.
//
// DELIBERATELY TRUNCATED after sendRAWData.
//
// AIDL assigns each method a binder transaction id from its position in the file,
// so every method BEFORE the one we call must be declared, in the published order,
// for the numbering to line up. Methods AFTER it cannot affect our transaction id —
// and dropping them removes the android.graphics.Bitmap and com.sunmi.trans.TransBean
// imports that the full interface would otherwise drag in.
//
// sendRAWData sits at index 10 (0-based). That position and its signature were
// cross-checked against two independent published copies of SUNMI's AIDL.
//
// If a future change needs printBitmap, printQRCode, or the buffer/transaction
// methods, restore the full published interface rather than appending here — the
// tail of the real interface has to match exactly too.
package woyou.aidlservice.jiuiv5;

import woyou.aidlservice.jiuiv5.ICallback;

interface IWoyouService {
    void updateFirmware();
    int getFirmwareStatus();
    String getServiceVersion();
    void printerInit(in ICallback callback);
    void printerSelfChecking(in ICallback callback);
    String getPrinterSerialNo();
    String getPrinterVersion();
    String getPrinterModal();
    void getPrintedLength(in ICallback callback);
    void lineWrap(int n, in ICallback callback);
    void sendRAWData(in byte[] data, in ICallback callback);
}
