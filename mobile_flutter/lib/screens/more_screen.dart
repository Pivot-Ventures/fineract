import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key, required this.onNavigate});
  final void Function(String route) onNavigate;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final s = state.session;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        const PageHeader('More', subtitle: 'Banking shortcuts, alerts and support.'),
        _tile(Icons.south_west, 'Deposit', 'Fund savings (green)', PivoColors.deposit, () => onNavigate('deposit')),
        _tile(Icons.north_east, 'Withdraw', 'Cash out (red)', PivoColors.withdraw, () => onNavigate('withdraw')),
        _tile(Icons.description_outlined, 'E-statement', 'Full transaction history', PivoColors.accent, () => onNavigate('statement')),
        _tile(Icons.account_balance, 'Loans', 'View & repay', PivoColors.ochre, () => onNavigate('loans')),
        _tile(Icons.person_outline, 'Profile', 'Member details', PivoColors.accent, () => onNavigate('profile')),
        _tile(Icons.help_outline, 'Help & support', 'Branch / SACCO desk', PivoColors.muted, () {
          showToast(context, 'Call your branch or visit the desk app for teller support.');
        }),
        const SizedBox(height: 16),
        if (s != null)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Signed in', style: TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Text(s.clientName),
                  Text('${s.clientAccountNo} · ${s.clientOffice}',
                      style: const TextStyle(fontSize: 12, color: PivoColors.muted)),
                  Text('API: ${state.apiBase}', style: const TextStyle(fontSize: 10, color: PivoColors.muted)),
                ],
              ),
            ),
          ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () async {
            await state.logout();
            if (context.mounted) showToast(context, 'Signed out');
          },
          icon: const Icon(Icons.logout),
          label: const Text('Sign out'),
        ),
      ],
    );
  }

  Widget _tile(IconData icon, String title, String sub, Color color, VoidCallback onTap) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        onTap: onTap,
        leading: CircleAvatar(
          backgroundColor: color.withValues(alpha: 0.12),
          child: Icon(icon, color: color, size: 20),
        ),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(sub, style: const TextStyle(fontSize: 12)),
        trailing: const Icon(Icons.chevron_right),
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
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        const PageHeader('Profile', subtitle: 'Member details and security.'),
        if (s != null) ...[
          Center(child: AvatarCircle(s.initials, size: 72)),
          const SizedBox(height: 12),
          Center(child: Text(s.clientName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
          Center(
            child: Text(s.clientAccountNo, style: const TextStyle(color: PivoColors.muted)),
          ),
          const SizedBox(height: 16),
          Card(
            child: Column(
              children: [
                ListTile(title: const Text('Office'), trailing: Text(b?.officeName ?? s.clientOffice)),
                const Divider(height: 1),
                ListTile(title: const Text('Member ref'), trailing: Text(s.memberRef)),
                const Divider(height: 1),
                ListTile(title: const Text('Tenant'), trailing: Text(s.tenantId)),
                const Divider(height: 1),
                const ListTile(
                  title: Text('Demo PIN'),
                  trailing: Text('1234'),
                  subtitle: Text('Staff+client bind (mifos)'),
                ),
              ],
            ),
          ),
        ],
        TextButton(onPressed: onBack, child: const Text('← Back')),
      ],
    );
  }
}
