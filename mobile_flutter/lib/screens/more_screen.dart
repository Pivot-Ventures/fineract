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
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
      children: [
        const PageHeader('More', subtitle: 'Banking shortcuts and account settings.'),
        const SizedBox(height: 8),
        _MenuCard(children: [
          _tile(Icons.south_west_rounded, 'Deposit', 'Fund your savings', PivoColors.deposit, () => onNavigate('deposit')),
          _tile(Icons.north_east_rounded, 'Withdraw', 'Cash out to MoMo', PivoColors.withdraw, () => onNavigate('withdraw')),
          _tile(Icons.description_outlined, 'E-statement', 'Full transaction history', PivoColors.accent, () => onNavigate('statement')),
          _tile(Icons.account_balance_rounded, 'Loans', 'View & repay', PivoColors.ochre, () => onNavigate('loans'), last: true),
        ]),
        const SizedBox(height: 12),
        _MenuCard(children: [
          _tile(Icons.person_outline_rounded, 'Profile', 'Member details', PivoColors.accent, () => onNavigate('profile')),
          _tile(Icons.help_outline_rounded, 'Help & support', 'Branch / SACCO desk', PivoColors.muted, () {
            showToast(context, 'Call your branch or visit the desk for teller support.');
          }, last: true),
        ]),
        const SizedBox(height: 16),
        if (s != null)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
            ),
            child: Row(
              children: [
                AvatarCircle(s.initials, size: 48),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(s.clientName, style: const TextStyle(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 2),
                      Text('${s.clientAccountNo} · ${s.clientOffice}',
                          style: const TextStyle(fontSize: 12, color: PivoColors.muted)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 16),
        OutlinedButton.icon(
          onPressed: () async {
            await state.logout();
            if (context.mounted) showToast(context, 'Signed out');
          },
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(48),
            foregroundColor: PivoColors.withdraw,
            side: const BorderSide(color: PivoColors.withdraw),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
          icon: const Icon(Icons.logout_rounded),
          label: const Text('Sign out', style: TextStyle(fontWeight: FontWeight.w700)),
        ),
      ],
    );
  }

  Widget _tile(IconData icon, String title, String sub, Color color, VoidCallback onTap, {bool last = false}) {
    return Column(
      children: [
        ListTile(
          onTap: onTap,
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
          leading: Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: color, size: 22),
          ),
          title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5)),
          subtitle: Text(sub, style: const TextStyle(fontSize: 12)),
          trailing: const Icon(Icons.chevron_right_rounded, color: PivoColors.muted),
        ),
        if (!last) const Divider(indent: 70, height: 1),
      ],
    );
  }
}

class _MenuCard extends StatelessWidget {
  const _MenuCard({required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 10, offset: const Offset(0, 3)),
        ],
      ),
      child: Column(children: children),
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
        const PageHeader('Profile', subtitle: 'Member details and security.'),
        if (s != null) ...[
          const SizedBox(height: 8),
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
                ListTile(title: const Text('Office'), trailing: Text(b?.officeName ?? s.clientOffice, style: const TextStyle(fontWeight: FontWeight.w600))),
                const Divider(height: 1),
                ListTile(title: const Text('Member ref'), trailing: Text(s.memberRef, style: const TextStyle(fontWeight: FontWeight.w600))),
                const Divider(height: 1),
                ListTile(title: const Text('Tenant'), trailing: Text(s.tenantId, style: const TextStyle(fontWeight: FontWeight.w600))),
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
