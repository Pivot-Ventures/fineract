import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _member = TextEditingController(text: '000000001');
  final _pin = TextEditingController(text: '1234');
  final _formKey = GlobalKey<FormState>();
  bool _busy = false;

  @override
  void dispose() {
    _member.dispose();
    _pin.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    HapticFeedback.mediumImpact();
    try {
      await context.read<AppState>().login(
            memberRef: _member.text.trim(),
            pin: _pin.text.trim(),
          );
    } catch (e) {
      if (mounted) showToast(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
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
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('PIVOSACC',
                      style: TextStyle(
                        color: Color(0xFF8FA8E8),
                        fontWeight: FontWeight.w800,
                        letterSpacing: 2,
                        fontSize: 13,
                      )),
                  const SizedBox(height: 8),
                  const Text('Member banking',
                      style: TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Text(
                    'Balances, deposits, statements and loans — same ledger as the branch desk.',
                    style: TextStyle(color: Colors.white.withValues(alpha: 0.7), height: 1.4),
                  ),
                  const SizedBox(height: 28),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text('Sign in', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                            const SizedBox(height: 6),
                            const Text(
                              'Enter your member number and PIN. Demo binds to a Fineract client via staff session.',
                              style: TextStyle(fontSize: 12.5, color: PivoColors.muted),
                            ),
                            const SizedBox(height: 18),
                            TextFormField(
                              controller: _member,
                              decoration: const InputDecoration(labelText: 'Member number'),
                              keyboardType: TextInputType.text,
                              validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                            ),
                            const SizedBox(height: 12),
                            TextFormField(
                              controller: _pin,
                              decoration: const InputDecoration(labelText: 'PIN'),
                              obscureText: true,
                              keyboardType: TextInputType.number,
                              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                              validator: (v) => (v == null || v.isEmpty) ? 'Required' : null,
                            ),
                            const SizedBox(height: 20),
                            FilledButton(
                              onPressed: _busy ? null : _submit,
                              child: _busy
                                  ? const SizedBox(
                                      height: 22,
                                      width: 22,
                                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                    )
                                  : const Text('Continue'),
                            ),
                            const SizedBox(height: 14),
                            Text(
                              'Demo auth: staff mifos + client bind. PIN 1234.',
                              style: TextStyle(fontSize: 11, color: Colors.black.withValues(alpha: 0.45)),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Center(
                    child: Text('LIVE · Fineract proxy · Apache Fineract',
                        style: TextStyle(color: Colors.white54, fontSize: 11)),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
