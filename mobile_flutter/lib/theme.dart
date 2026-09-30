import 'package:flutter/material.dart';

class PivoColors {
  static const accent = Color(0xFF21409A);
  static const accent600 = Color(0xFF1B3480);
  static const accent900 = Color(0xFF0B1633);
  static const accent100 = Color(0xFFE9EDF8);
  static const accent50 = Color(0xFFF3F5FB);
  static const ochre = Color(0xFF9E661F);
  static const good = Color(0xFF2E6B4F);
  static const goodSoft = Color(0xFFE8F3ED);
  static const deposit = Color(0xFF1B7A4A);
  static const depositSoft = Color(0xFFE6F6EE);
  static const withdraw = Color(0xFFC62828);
  static const withdrawSoft = Color(0xFFFDECEA);
  static const bg = Color(0xFFF4F5F7);
  static const muted = Color(0xFF7A7A7D);
  static const momo = Color(0xFFFFCC00);
  static const airtel = Color(0xFFED1C24);
  static const nwsc = Color(0xFF0B6BCB);
  static const umeme = Color(0xFFF5A623);
  static const dstv = Color(0xFF5B2C8A);
  static const school = Color(0xFF1A8A7A);

  // Dock / nav semantic colors (Option B — always colored)
  static const navHome = Color(0xFF21409A);
  static const navHomeMuted = Color(0xFF788CB4);
  static const navTransfer = Color(0xFF0D9488);
  static const navTransferMuted = Color(0xFF6BB5AE);
  static const navBills = Color(0xFFD97706);
  static const navBillsMuted = Color(0xFFBE9660);
  static const navLoans = Color(0xFF9E661F);
  static const navLoansMuted = Color(0xFFAA8C5A);
  static const navMore = Color(0xFF64748B);
  static const navMoreMuted = Color(0xFF94A3B8);
}


ThemeData buildPivosaccTheme() {
  final base = ColorScheme.fromSeed(
    seedColor: PivoColors.accent,
    brightness: Brightness.light,
    primary: PivoColors.accent,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: base.copyWith(
      primary: PivoColors.accent,
      secondary: PivoColors.good,
      error: PivoColors.withdraw,
      surface: Colors.white,
      surfaceContainerHighest: PivoColors.accent50,
    ),
    scaffoldBackgroundColor: PivoColors.bg,
    appBarTheme: AppBarTheme(
      backgroundColor: PivoColors.bg,
      foregroundColor: PivoColors.accent900,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: const TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w700,
        color: PivoColors.accent900,
        letterSpacing: -0.3,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      elevation: 0,
      height: 68,
      indicatorColor: PivoColors.accent.withValues(alpha: 0.12),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return TextStyle(
          fontSize: 11,
          fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          color: selected ? PivoColors.accent : PivoColors.muted,
        );
      }),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return IconThemeData(
          size: 24,
          color: selected ? PivoColors.accent : PivoColors.muted,
        );
      }),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: Colors.black.withValues(alpha: 0.10)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: Colors.black.withValues(alpha: 0.10)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: PivoColors.accent, width: 1.6),
      ),
      labelStyle: const TextStyle(color: PivoColors.muted, fontSize: 13),
    ),
    chipTheme: ChipThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      side: BorderSide(color: Colors.black.withValues(alpha: 0.10)),
      selectedColor: PivoColors.accent50,
      labelStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12),
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Colors.black.withValues(alpha: 0.06)),
      ),
    ),
    dividerTheme: DividerThemeData(
      color: Colors.black.withValues(alpha: 0.06),
      thickness: 1,
      space: 1,
    ),
  );
}

ThemeData depositTheme(ThemeData base) => base.copyWith(
      colorScheme: base.colorScheme.copyWith(primary: PivoColors.deposit),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: PivoColors.deposit,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
        ),
      ),
    );

ThemeData withdrawTheme(ThemeData base) => base.copyWith(
      colorScheme: base.colorScheme.copyWith(primary: PivoColors.withdraw),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: PivoColors.withdraw,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
        ),
      ),
    );
