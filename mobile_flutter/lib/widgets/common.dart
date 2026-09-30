import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../theme.dart';

void showToast(BuildContext context, String msg, {bool error = false, bool warn = false}) {
  final color = error
      ? PivoColors.withdraw
      : warn
          ? PivoColors.ochre
          : PivoColors.good;
  ScaffoldMessenger.of(context).hideCurrentSnackBar();
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(msg, style: const TextStyle(fontWeight: FontWeight.w600)),
      backgroundColor: color,
      behavior: SnackBarBehavior.floating,
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 88),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      duration: const Duration(seconds: 3),
    ),
  );
  HapticFeedback.lightImpact();
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 12, bottom: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              text.toUpperCase(),
              style: const TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: PivoColors.muted,
                letterSpacing: 0.7,
              ),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

class PageHeader extends StatelessWidget {
  const PageHeader(this.title, {super.key, this.subtitle});
  final String title;
  final String? subtitle;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: PivoColors.accent900,
              letterSpacing: -0.4,
            ),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 6),
            Text(subtitle!, style: const TextStyle(fontSize: 12, color: PivoColors.muted, height: 1.35)),
          ],
        ],
      ),
    );
  }
}

class AmountChips extends StatelessWidget {
  const AmountChips({
    super.key,
    required this.amounts,
    required this.selected,
    required this.onSelect,
    this.accent,
  });
  final List<int> amounts;
  final int? selected;
  final ValueChanged<int> onSelect;
  final Color? accent;

  @override
  Widget build(BuildContext context) {
    final a = accent ?? PivoColors.accent;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: amounts.map((amt) {
        final sel = selected == amt;
        return ChoiceChip(
          label: Text(_fmt(amt)),
          selected: sel,
          onSelected: (_) {
            HapticFeedback.selectionClick();
            onSelect(amt);
          },
          selectedColor: a.withValues(alpha: 0.14),
          side: BorderSide(color: sel ? a : Colors.black12, width: sel ? 1.5 : 1),
          labelStyle: TextStyle(
            fontWeight: FontWeight.w700,
            color: sel ? a : PivoColors.accent900,
            fontSize: 12.5,
          ),
        );
      }).toList(),
    );
  }

  String _fmt(int n) => n.toString().replaceAllMapped(
        RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
        (m) => '${m[1]},',
      );
}

class RailTile extends StatelessWidget {
  const RailTile({
    super.key,
    required this.asset,
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.onTap,
    this.selectedBorder,
  });
  final String asset;
  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;
  final Color? selectedBorder;

  @override
  Widget build(BuildContext context) {
    final border = selectedBorder ?? PivoColors.accent;
    return InkWell(
      onTap: () {
        HapticFeedback.selectionClick();
        onTap();
      },
      borderRadius: BorderRadius.circular(16),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        decoration: BoxDecoration(
          color: selected ? border.withValues(alpha: 0.07) : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? border : Colors.black.withValues(alpha: 0.08),
            width: selected ? 1.8 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: selected ? 0.06 : 0.03),
              blurRadius: 10,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Row(
          children: [
            SvgPicture.asset(asset, width: 46, height: 46),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                  const SizedBox(height: 2),
                  Text(subtitle, style: const TextStyle(fontSize: 12.5, color: PivoColors.muted)),
                ],
              ),
            ),
            Icon(
              selected ? Icons.check_circle_rounded : Icons.circle_outlined,
              color: selected ? border : Colors.black26,
              size: 24,
            ),
          ],
        ),
      ),
    );
  }
}

class BillerTile extends StatelessWidget {
  const BillerTile({
    super.key,
    required this.asset,
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.onTap,
    required this.accent,
  });
  final String asset;
  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {
        HapticFeedback.selectionClick();
        onTap();
      },
      borderRadius: BorderRadius.circular(16),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: selected ? accent.withValues(alpha: 0.08) : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? accent : Colors.black.withValues(alpha: 0.08),
            width: selected ? 1.8 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.04),
              blurRadius: 10,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SvgPicture.asset(asset, width: 42, height: 42),
            const SizedBox(height: 12),
            Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5)),
            const SizedBox(height: 2),
            Text(subtitle, style: const TextStyle(fontSize: 11.5, color: PivoColors.muted)),
          ],
        ),
      ),
    );
  }
}

class LiveChip extends StatelessWidget {
  const LiveChip({super.key});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: PivoColors.goodSoft,
        borderRadius: BorderRadius.circular(20),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.circle, size: 7, color: PivoColors.good),
          SizedBox(width: 5),
          Text('LIVE', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: PivoColors.good, letterSpacing: 0.4)),
        ],
      ),
    );
  }
}

class LoadingPane extends StatelessWidget {
  const LoadingPane({super.key, this.label = 'Loading…'});
  final String label;
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(color: PivoColors.accent),
          const SizedBox(height: 16),
          Text(label, style: const TextStyle(color: PivoColors.muted, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

class AvatarCircle extends StatelessWidget {
  const AvatarCircle(this.initials, {super.key, this.onTap, this.size = 36});
  final String initials;
  final VoidCallback? onTap;
  final double size;
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: const LinearGradient(
            colors: [PivoColors.accent, PivoColors.accent900],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          boxShadow: [
            BoxShadow(
              color: PivoColors.accent.withValues(alpha: 0.35),
              blurRadius: 8,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        alignment: Alignment.center,
        child: Text(
          initials,
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: size * 0.34),
        ),
      ),
    );
  }
}

/// Signed money colour: deposits green, withdrawals/outflows red.
Color amountColor(bool isCredit) => isCredit ? PivoColors.deposit : PivoColors.withdraw;

class SoftBanner extends StatelessWidget {
  const SoftBanner({
    super.key,
    required this.icon,
    required this.label,
    required this.color,
    required this.soft,
  });
  final IconData icon;
  final String label;
  final Color color;
  final Color soft;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: soft,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.75),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(label, style: TextStyle(fontWeight: FontWeight.w700, color: color, fontSize: 14.5)),
          ),
        ],
      ),
    );
  }
}
