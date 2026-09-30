import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key, required this.onNavigate});
  final void Function(String route) onNavigate;

  static const _appVersion = '1.0.12';

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
              onTap: () => showToast(context, 'PIN change coming soon. Demo PIN remains 1234.', warn: true),
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
          onTap: () => showToast(context, 'Call your branch or visit the desk for teller support.'),
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
                  'Native Flutter client for Apache Fineract.\n'
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
                content: const Text('You will need your member number and PIN to sign in again.'),
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
              await state.logout();
              if (context.mounted) showToast(context, 'Signed out');
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
                  title: const Text('Member ref'),
                  trailing: Text(s.memberRef, style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                const Divider(height: 1),
                ListTile(
                  title: const Text('Tenant'),
                  trailing: Text(s.tenantId, style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 16),
        TextButton(onPressed: onBack, child: const Text('← Back to More')),
      ],
    );
  }
}
