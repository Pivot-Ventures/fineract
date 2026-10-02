import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../api/gateway_api.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/pin_pad.dart';

/// PIN unlock for a phone that is already registered.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _unlock(String pin) async {
    final state = context.read<AppState>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await state.unlock(pin);
    } on ApiException catch (e) {
      HapticFeedback.heavyImpact();
      if (e.code == 'device_not_registered' || e.code == 'not_registered') {
        await state.forgetDevice();
        if (mounted) showToast(context, e.message, error: true);
        return;
      }
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _forgotPin() async {
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Forgot your PIN?'),
        content: const Text(
          'For your security, PINs can only be reset at a Pivot SACCO branch. Bring your national ID; '
          'staff will give you a new activation code to set a new PIN on this phone.',
        ),
        actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
      ),
    );
  }

  Future<void> _notYou() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Use a different account?'),
        content: const Text('This removes the saved member number from this phone. '
            'You will need an activation code from your branch to sign in again.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Continue')),
        ],
      ),
    );
    if (ok == true && mounted) await context.read<AppState>().forgetDevice();
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final name = (state.firstName ?? '').isEmpty ? 'back' : state.firstName!;
    return Scaffold(
      backgroundColor: PivoColors.accent900,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
            child: Column(
              children: [
                const _Brand(),
                const SizedBox(height: 28),
                Text('Welcome $name',
                    style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                Text('Member ${state.memberNo ?? ''} · Enter your PIN',
                    style: TextStyle(color: Colors.white.withValues(alpha: 0.7))),
                if (state.lockReason != null && _error == null) ...[
                  const SizedBox(height: 10),
                  Text(state.lockReason!,
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 12)),
                ],
                const SizedBox(height: 24),
                PinPad(onComplete: _unlock, dark: true, busy: _busy, error: _error),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    TextButton(
                      onPressed: _forgotPin,
                      child: const Text('Forgot PIN?', style: TextStyle(color: Color(0xFF8FA8E8))),
                    ),
                    const Text('·', style: TextStyle(color: Colors.white38)),
                    TextButton(
                      onPressed: _notYou,
                      child: const Text('Not you?', style: TextStyle(color: Color(0xFF8FA8E8))),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// First-time setup: member number + activation code from the branch, then a new PIN (twice).
class ActivationScreen extends StatefulWidget {
  const ActivationScreen({super.key});
  @override
  State<ActivationScreen> createState() => _ActivationScreenState();
}

enum _ActStep { details, pin, confirmPin }

class _ActivationScreenState extends State<ActivationScreen> {
  final _member = TextEditingController();
  final _code = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  _ActStep _step = _ActStep.details;
  String _firstPin = '';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _member.dispose();
    _code.dispose();
    super.dispose();
  }

  static bool _weak(String pin) {
    if (pin.split('').toSet().length == 1) return true;
    const seq = '01234567890';
    const rev = '09876543210';
    return seq.contains(pin) || rev.contains(pin);
  }

  Future<void> _onPin(String pin) async {
    if (_step == _ActStep.pin) {
      if (_weak(pin)) {
        HapticFeedback.heavyImpact();
        setState(() => _error = 'That PIN is too easy to guess. Avoid repeated or consecutive digits.');
        return;
      }
      setState(() {
        _firstPin = pin;
        _error = null;
        _step = _ActStep.confirmPin;
      });
      return;
    }
    if (pin != _firstPin) {
      HapticFeedback.heavyImpact();
      setState(() {
        _error = 'The PINs did not match. Choose your PIN again.';
        _step = _ActStep.pin;
      });
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<AppState>().activate(
            memberNo: _member.text.trim(),
            code: _code.text.replaceAll(RegExp(r'\D'), ''),
            pin: pin,
          );
    } on ApiException catch (e) {
      HapticFeedback.heavyImpact();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.message;
        // A PIN problem keeps the member on the PIN step; anything else goes back to the details.
        _step = e.code == 'weak_pin' ? _ActStep.pin : _ActStep.details;
      });
      if (_step == _ActStep.details) showToast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: PivoColors.accent900,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: _step == _ActStep.details ? _details() : _pinStep(),
            ),
          ),
        ),
      ),
    );
  }

  Widget _details() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _Brand(),
        const SizedBox(height: 10),
        const Text('Set up mobile banking',
            style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        Text(
          'Check balances, send money to members and repay loans from your phone.',
          style: TextStyle(color: Colors.white.withValues(alpha: 0.7), height: 1.4),
        ),
        const SizedBox(height: 24),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Form(
              key: _formKey,
              autovalidateMode: AutovalidateMode.onUserInteraction,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    controller: _member,
                    decoration: const InputDecoration(labelText: 'Member number', hintText: 'e.g. 000000123'),
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(12)],
                    validator: (v) => (v == null || v.trim().isEmpty) ? 'Enter your member number' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _code,
                    decoration: const InputDecoration(
                      labelText: 'Activation code',
                      hintText: '8 digits from your branch',
                    ),
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d ]')), LengthLimitingTextInputFormatter(9)],
                    validator: (v) =>
                        (v ?? '').replaceAll(RegExp(r'\D'), '').length != 8 ? 'Enter the 8-digit code' : null,
                  ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: () {
                      if (!_formKey.currentState!.validate()) return;
                      FocusScope.of(context).unfocus();
                      setState(() {
                        _error = null;
                        _step = _ActStep.pin;
                      });
                    },
                    child: const Text('Continue'),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text(
          'No activation code? Visit any Pivot SACCO branch with your national ID. '
          'Staff will never ask for your PIN.',
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 12, height: 1.4),
        ),
      ],
    );
  }

  Widget _pinStep() {
    final confirming = _step == _ActStep.confirmPin;
    return Column(
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: IconButton(
            onPressed: _busy ? null : () => setState(() => _step = _ActStep.details),
            icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 18),
          ),
        ),
        Text(confirming ? 'Confirm your PIN' : 'Create a 4-digit PIN',
            style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        Text(
          confirming ? 'Enter the same PIN again.' : 'You will use it to sign in and to approve every payment.',
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.white.withValues(alpha: 0.7)),
        ),
        const SizedBox(height: 24),
        PinPad(key: ValueKey(_step), onComplete: _onPin, dark: true, busy: _busy, error: _error),
      ],
    );
  }
}

class _Brand extends StatelessWidget {
  const _Brand();
  @override
  Widget build(BuildContext context) {
    return const Text('PIVOSACC',
        textAlign: TextAlign.center,
        style: TextStyle(color: Color(0xFF8FA8E8), fontWeight: FontWeight.w800, letterSpacing: 2, fontSize: 13));
  }
}
