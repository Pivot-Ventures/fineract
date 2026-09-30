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
  static const bg = Color(0xFFF2F2F3);
  static const muted = Color(0xFF7A7A7D);
  static const momo = Color(0xFFFFCC00);
  static const airtel = Color(0xFFED1C24);
  static const nwsc = Color(0xFF0B6BCB);
  static const umeme = Color(0xFFF5A623);
  static const dstv = Color(0xFF5B2C8A);
  static const school = Color(0xFF1A8A7A);
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
    ),
    scaffoldBackgroundColor: PivoColors.bg,
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: PivoColors.accent900,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w700,
        color: PivoColors.accent900,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: Colors.black.withValues(alpha: 0.16)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: Colors.black.withValues(alpha: 0.16)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: PivoColors.accent, width: 1.5),
      ),
      labelStyle: const TextStyle(color: PivoColors.muted, fontSize: 13),
    ),
    chipTheme: ChipThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      side: BorderSide(color: Colors.black.withValues(alpha: 0.12)),
      selectedColor: PivoColors.accent50,
      labelStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: Colors.black.withValues(alpha: 0.08)),
      ),
    ),
  );
}

ThemeData depositTheme(ThemeData base) => base.copyWith(
      colorScheme: base.colorScheme.copyWith(primary: PivoColors.deposit),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: PivoColors.deposit,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
    );

ThemeData withdrawTheme(ThemeData base) => base.copyWith(
      colorScheme: base.colorScheme.copyWith(primary: PivoColors.withdraw),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: PivoColors.withdraw,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
    );
