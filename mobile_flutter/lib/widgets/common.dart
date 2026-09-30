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
      content: Text(msg),
      backgroundColor: color,
      behavior: SnackBarBehavior.floating,
      margin: const EdgeInsets.all(12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      duration: const Duration(seconds: 3),
    ),
  );
  HapticFeedback.lightImpact();
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 8),
      child: Text(
        text.toUpperCase(),
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: PivoColors.muted,
          letterSpacing: 0.6,
        ),
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
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w700,
              color: PivoColors.accent900,
            ),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(subtitle!, style: const TextStyle(fontSize: 13, color: PivoColors.muted, height: 1.35)),
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
          selectedColor: a.withValues(alpha: 0.15),
          side: BorderSide(color: sel ? a : Colors.black12, width: sel ? 1.5 : 1),
          labelStyle: TextStyle(
            fontWeight: FontWeight.w600,
            color: sel ? a : PivoColors.accent900,
            fontSize: 12,
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
      borderRadius: BorderRadius.circular(14),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected ? border.withValues(alpha: 0.06) : Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected ? border : Colors.black.withValues(alpha: 0.12),
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            SvgPicture.asset(asset, width: 44, height: 44),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text(subtitle, style: const TextStyle(fontSize: 12, color: PivoColors.muted)),
                ],
              ),
            ),
            Icon(
              selected ? Icons.check_circle : Icons.circle_outlined,
              color: selected ? border : Colors.black26,
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
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected ? accent.withValues(alpha: 0.08) : Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected ? accent : Colors.black.withValues(alpha: 0.12),
            width: selected ? 1.8 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.04),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SvgPicture.asset(asset, width: 40, height: 40),
            const SizedBox(height: 10),
            Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
            const SizedBox(height: 2),
            Text(subtitle, style: const TextStyle(fontSize: 11, color: PivoColors.muted)),
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
          Icon(Icons.circle, size: 8, color: PivoColors.good),
          SizedBox(width: 4),
          Text('LIVE', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: PivoColors.good)),
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
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(label, style: const TextStyle(color: PivoColors.muted)),
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
        decoration: const BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(
            colors: [PivoColors.accent, PivoColors.accent900],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        alignment: Alignment.center,
        child: Text(
          initials,
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: size * 0.35),
        ),
      ),
    );
  }
}
