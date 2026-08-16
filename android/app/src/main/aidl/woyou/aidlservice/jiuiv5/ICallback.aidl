// SUNMI inner-printer callback interface.
//
// Declaration ORDER is the contract: AIDL derives binder transaction ids from the
// position of each method, so these must stay exactly as SUNMI publishes them.
// Verified against SUNMI's published AIDL (cordova-plugin-sunmi-inner-printer and
// react-native-sunmi-v2-printer agree on this order).
//
// The app only relies on onRunResult (0) and onRaiseException (2); the others are
// declared to hold their slots so the numbering stays correct.
package woyou.aidlservice.jiuiv5;

interface ICallback {
    oneway void onRunResult(boolean isSuccess);
    oneway void onReturnString(String result);
    oneway void onRaiseException(int code, String msg);
    oneway void onPrintResult(int code, String msg);
}
