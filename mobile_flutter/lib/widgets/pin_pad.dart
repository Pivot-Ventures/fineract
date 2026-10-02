import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../api/gateway_api.dart';
import '../theme.dart';

const kPinLength = 4;

/// Four PIN dots plus a numeric keypad. Calls [onComplete] when four digits are entered.
class PinPad extends StatefulWidget {
  const PinPad({
    super.key,
    required this.onComplete,
    this.dark = false,
    this.busy = false,
    this.error,
  });

  final Future<void> Function(String pin) onComplete;
  final bool dark;
  final bool busy;
  final String? error;

  @override
  State<PinPad> createState() => PinPadState();
}

class PinPadState extends State<PinPad> {
  String _pin = '';

  void clear() => setState(() => _pin = '');

  Future<void> _press(String k) async {
    if (widget.busy) return;
    HapticFeedback.selectionClick();
    if (k == '⌫') {
      if (_pin.isNotEmpty) setState(() => _pin = _pin.substring(0, _pin.length - 1));
      return;
    }
    if (_pin.length >= kPinLength) return;
    setState(() => _pin += k);
    if (_pin.length == kPinLength) {
      final pin = _pin;
      await widget.onComplete(pin);
      if (mounted) setState(() => _pin = '');
    }
  }

  @override
  Widget build(BuildContext context) {
    final fg = widget.dark ? Colors.white : PivoColors.accent900;
    final dotOff = widget.dark ? Colors.white24 : const Color(0xFFD5D8DE);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          height: 24,
          child: widget.busy
              ? SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: fg))
              : Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(kPinLength, (i) {
                    final on = i < _pin.length;
                    return AnimatedContainer(
                      duration: const Duration(milliseconds: 120),
                      margin: const EdgeInsets.symmetric(horizontal: 10),
                      width: 16,
                      height: 16,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: on ? fg : Colors.transparent,
                        border: Border.all(color: on ? fg : dotOff, width: 2),
                      ),
                    );
                  }),
                ),
        ),
        SizedBox(
          height: 44,
          child: Center(
            child: widget.error == null
                ? null
                : Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Text(
                      widget.error!,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: widget.dark ? const Color(0xFFFFB4AB) : PivoColors.withdraw,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
          ),
        ),
        for (final row in const [
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
          ['', '0', '⌫'],
        ])
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (final k in row)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                  child: k.isEmpty
                      ? const SizedBox(width: 68, height: 68)
                      : Semantics(
                          button: true,
                          label: k == '⌫' ? 'Delete' : k,
                          child: InkResponse(
                            onTap: () => _press(k),
                            radius: 38,
                            child: Container(
                              width: 68,
                              height: 68,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: k == '⌫'
                                    ? Colors.transparent
                                    : (widget.dark ? Colors.white.withValues(alpha: 0.08) : const Color(0xFFF1F3F7)),
                              ),
                              child: k == '⌫'
                                  ? Icon(Icons.backspace_outlined, color: fg, size: 22)
                                  : Text(k, style: TextStyle(color: fg, fontSize: 26, fontWeight: FontWeight.w600)),
                            ),
                          ),
                        ),
                ),
            ],
          ),
      ],
    );
  }
}

/// Bottom sheet asking for the member's PIN to authorise a payment. The [submit] callback sends
/// the request with the PIN; the sheet stays open on a wrong PIN so the member can retry, and
/// closes with the callback's result on success. Returns null if the member cancels; any other
/// error (rejected payment, lock, no connection) closes the sheet and is rethrown to the caller.
Future<T?> confirmWithPin<T>(
  BuildContext context, {
  required String title,
  required String summary,
  required Future<T> Function(String pin) submit,
}) async {
  final result = await showModalBottomSheet<Object?>(
    context: context,
    isScrollControlled: true,
    isDismissible: false,
    enableDrag: false,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (ctx) => _PinSheet<T>(title: title, summary: summary, submit: submit),
  );
  if (result is _PinFailure) throw result.error;
  return result as T?;
}

class _PinFailure {
  _PinFailure(this.error);
  final Object error;
}

class _PinSheet<T> extends StatefulWidget {
  const _PinSheet({required this.title, required this.summary, required this.submit});
  final String title;
  final String summary;
  final Future<T> Function(String pin) submit;

  @override
  State<_PinSheet<T>> createState() => _PinSheetState<T>();
}

class _PinSheetState<T> extends State<_PinSheet<T>> {
  bool _busy = false;
  String? _error;

  Future<void> _go(String pin) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.submit(pin);
      if (mounted) Navigator.pop(context, result);
    } catch (e) {
      final msg = e.toString();
      // Anything other than a wrong PIN (rejected payment, lock, network) closes the sheet and
      // goes back to the screen, which shows the error.
      final wrongPin = e is ApiException && e.code == 'wrong_pin';
      if (!wrongPin) {
        if (mounted) Navigator.pop(context, _PinFailure(e));
        return;
      }
      HapticFeedback.heavyImpact();
      if (mounted) {
        setState(() {
          _busy = false;
          _error = msg;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(color: const Color(0xFFD2D5DB), borderRadius: BorderRadius.circular(2)),
            ),
            const SizedBox(height: 14),
            Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
            const SizedBox(height: 4),
            Text(widget.summary,
                textAlign: TextAlign.center, style: const TextStyle(color: PivoColors.muted, fontSize: 12.5)),
            const SizedBox(height: 18),
            PinPad(onComplete: _go, busy: _busy, error: _error),
            TextButton(
              onPressed: _busy ? null : () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
          ],
        ),
      ),
    );
  }
}
