import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/pin_pad.dart';

class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key, required this.onNavigate});
  final void Function(String route) onNavigate;

  static const _appVersion = '1.1.0';

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final s = state.session;
    final firstName = (s?.clientName ?? 'Member').split(' ').first;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
      children: [
        const PageHeader('More', subtitle: 'Manage your account and preferences.'),
        const SizedBox(height: 8),
        if (s != null)
          Material(
            color: const Color(0xFFEEF1F6),
            borderRadius: BorderRadius.circular(16),
            child: InkWell(
              onTap: () => onNavigate('profile'),
              borderRadius: BorderRadius.circular(16),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    AvatarCircle(s.initials, size: 48),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(firstName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                          Text(
                            'Member · ${s.clientAccountNo}',
                            style: const TextStyle(color: PivoColors.muted, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.chevron_right_rounded, color: PivoColors.muted),
                  ],
                ),
              ),
            ),
          ),
        const SizedBox(height: 18),
        const _SectionLab('Account'),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.35,
          children: [
            _GridTile(
              icon: Icons.person_rounded,
              color: PivoColors.accent,
              title: 'Profile',
              subtitle: 'Personal details',
              onTap: () => onNavigate('profile'),
            ),
            _GridTile(
              icon: Icons.receipt_long_rounded,
              color: PivoColors.accent,
              title: 'Statements',
              subtitle: 'Download history',
              onTap: () => onNavigate('statement'),
            ),
            _GridTile(
              icon: Icons.verified_user_rounded,
              color: PivoColors.navMore,
              title: 'PIN & security',
              subtitle: 'Keep your account safe',
              onTap: () => showSecuritySheet(context),
            ),
            _GridTile(
              icon: Icons.notifications_active_rounded,
              color: PivoColors.navMore,
              title: 'Notifications',
              subtitle: 'Alerts and reminders',
              onTap: () => showToast(context, 'Notification preferences coming soon.', warn: true),
            ),
          ],
        ),
        const SizedBox(height: 18),
        const _SectionLab('Help & information'),
        _HelpTile(
          icon: Icons.help_outline_rounded,
          color: PivoColors.navMore,
          title: 'Support',
          subtitle: 'Get help from Pivosacc',
          onTap: () => showToast(context, 'Call or visit your branch. Staff will never ask for your PIN.'),
        ),
        const SizedBox(height: 8),
        _HelpTile(
          icon: Icons.info_outline_rounded,
          color: PivoColors.navMore,
          title: 'About Pivosacc',
          subtitle: 'Version and legal',
          onTap: () {
            showDialog(
              context: context,
              builder: (ctx) => AlertDialog(
                title: const Text('About Pivosacc'),
                content: Text(
                  'Pivosacc member banking\nVersion $_appVersion\n\n'
                  'Mobile banking for Pivot SACCO members.\n'
                  '© Pivot Ventures',
                ),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
                ],
              ),
            );
          },
        ),
        const SizedBox(height: 8),
        _HelpTile(
          icon: Icons.logout_rounded,
          color: PivoColors.withdraw,
          title: 'Logout',
          subtitle: 'Sign out of this device',
          onTap: () async {
            final go = await showDialog<bool>(
              context: context,
              builder: (ctx) => AlertDialog(
                title: const Text('Sign out?'),
                content: const Text('You will need your PIN to sign in again.'),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                  FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: PivoColors.withdraw),
                    onPressed: () => Navigator.pop(ctx, true),
                    child: const Text('Logout'),
                  ),
                ],
              ),
            );
            if (go == true) {
              state.lock(reason: 'You signed out.');
            }
          },
        ),
      ],
    );
  }
}

class _SectionLab extends StatelessWidget {
  const _SectionLab(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(text, style: const TextStyle(color: PivoColors.muted, fontWeight: FontWeight.w700, fontSize: 11)),
      );
}

class _GridTile extends StatelessWidget {
  const _GridTile({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: color, size: 18),
              ),
              const Spacer(),
              Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
              Text(subtitle, style: const TextStyle(color: PivoColors.muted, fontSize: 10.5)),
            ],
          ),
        ),
      ),
    );
  }
}

class _HelpTile extends StatelessWidget {
  const _HelpTile({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
          ),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: color, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                    Text(subtitle, style: const TextStyle(color: PivoColors.muted, fontSize: 11)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: PivoColors.muted),
            ],
          ),
        ),
      ),
    );
  }
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key, required this.onBack});
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final s = state.session;
    final b = state.bundle;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
      children: [
        Row(
          children: [
            IconButton(
              visualDensity: VisualDensity.compact,
              onPressed: onBack,
              icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
            ),
            const Expanded(child: Text('Profile', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
          ],
        ),
        const Text('Member details and security.', style: TextStyle(color: PivoColors.muted, fontSize: 12)),
        if (s != null) ...[
          const SizedBox(height: 16),
          Center(child: AvatarCircle(s.initials, size: 80)),
          const SizedBox(height: 14),
          Center(child: Text(s.clientName, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800))),
          Center(child: Text(s.clientAccountNo, style: const TextStyle(color: PivoColors.muted, fontSize: 13.5))),
          const SizedBox(height: 20),
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
            ),
            child: Column(
              children: [
                ListTile(
                  title: const Text('Office'),
                  trailing: Text(b?.officeName ?? s.clientOffice, style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                const Divider(height: 1),
                ListTile(
                  title: const Text('Mobile number'),
                  trailing: Text(s.mobile.isEmpty ? '—' : s.mobile, style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                const Divider(height: 1),
                ListTile(
                  title: const Text('Registered phone'),
                  trailing: Text(s.device.isEmpty ? 'This phone' : s.device,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 12),
        const Text('To change your name, phone number or other details, visit your branch.',
            style: TextStyle(color: PivoColors.muted, fontSize: 12)),
        const SizedBox(height: 8),
        TextButton(onPressed: onBack, child: const Text('← Back to More')),
      ],
    );
  }
}


/// PIN change and unlinking this phone.
Future<void> showSecuritySheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('PIN & security', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 4),
            const Text('The app locks after 3 minutes without activity or 1 minute in the background.',
                style: TextStyle(color: PivoColors.muted, fontSize: 12)),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.password_rounded, color: PivoColors.accent),
              title: const Text('Change PIN', style: TextStyle(fontWeight: FontWeight.w700)),
              onTap: () {
                Navigator.pop(ctx);
                Navigator.of(context).push(MaterialPageRoute(builder: (_) => const _ChangePinScreen()));
              },
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.phonelink_erase_rounded, color: PivoColors.withdraw),
              title: const Text('Unlink this phone', style: TextStyle(fontWeight: FontWeight.w700)),
              subtitle: const Text('Lost or changing phones? You will need a new activation code from your branch.'),
              onTap: () async {
                Navigator.pop(ctx);
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (d) => AlertDialog(
                    title: const Text('Unlink this phone?'),
                    content: const Text('Mobile banking will stop working on this phone until you activate it '
                        'again with a code from your branch.'),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
                      FilledButton(
                        style: FilledButton.styleFrom(backgroundColor: PivoColors.withdraw),
                        onPressed: () => Navigator.pop(d, true),
                        child: const Text('Unlink'),
                      ),
                    ],
                  ),
                );
                if (ok == true && context.mounted) {
                  try {
                    await context.read<AppState>().deregister();
                  } catch (e) {
                    if (context.mounted) showToast(context, e.toString(), error: true);
                  }
                }
              },
            ),
          ],
        ),
      ),
    ),
  );
}

enum _PinStep { current, fresh, confirm }

class _ChangePinScreen extends StatefulWidget {
  const _ChangePinScreen();
  @override
  State<_ChangePinScreen> createState() => _ChangePinScreenState();
}

class _ChangePinScreenState extends State<_ChangePinScreen> {
  _PinStep _step = _PinStep.current;
  String _current = '';
  String _fresh = '';
  bool _busy = false;
  String? _error;

  Future<void> _onPin(String pin) async {
    switch (_step) {
      case _PinStep.current:
        setState(() {
          _current = pin;
          _error = null;
          _step = _PinStep.fresh;
        });
      case _PinStep.fresh:
        setState(() {
          _fresh = pin;
          _error = null;
          _step = _PinStep.confirm;
        });
      case _PinStep.confirm:
        if (pin != _fresh) {
          setState(() {
            _error = 'The new PINs did not match. Enter your new PIN again.';
            _step = _PinStep.fresh;
          });
          return;
        }
        final state = context.read<AppState>();
        setState(() => _busy = true);
        try {
          await state.api.changePin(_current, _fresh);
          if (!mounted) return;
          showToast(context, 'PIN changed');
          Navigator.pop(context);
        } catch (e) {
          if (state.handleSessionError(e)) {
            if (mounted) Navigator.pop(context);
            return;
          }
          if (mounted) {
            setState(() {
              _busy = false;
              _error = e.toString();
              _step = _PinStep.current;
            });
          }
        }
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = switch (_step) {
      _PinStep.current => 'Enter your current PIN',
      _PinStep.fresh => 'Choose a new 4-digit PIN',
      _PinStep.confirm => 'Confirm your new PIN',
    };
    return Scaffold(
      appBar: AppBar(title: const Text('Change PIN')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            child: Column(
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
                const SizedBox(height: 24),
                PinPad(key: ValueKey(_step), onComplete: _onPin, busy: _busy, error: _error),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
