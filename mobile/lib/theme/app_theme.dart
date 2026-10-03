import 'package:flutter/material.dart';

const Color kBg = Color(0xFF08080B);
const Color kSurface1 = Color(0xFF101015);
const Color kSurface2 = Color(0xFF18181F);
const Color kSurface3 = Color(0xFF21212A);
const Color kAccent = Color(0xFFFF2E4D);
const Color kTextPrimary = Color(0xFFF7EEF0);
const Color kTextSecondary = Color(0xFFB9A7AC);
const Color kTextMuted = Color(0xFF7E6B71);
const Color kBorder = Color(0x14FFFFFF);

ThemeData buildAriaTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: kBg,
    colorScheme: base.colorScheme.copyWith(
      primary: kAccent,
      secondary: kAccent,
      surface: kSurface1,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: kSurface1,
      foregroundColor: kTextPrimary,
      elevation: 0,
      centerTitle: false,
    ),
    drawerTheme: const DrawerThemeData(backgroundColor: kSurface1),
    dialogTheme: const DialogTheme(backgroundColor: kSurface1),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: kSurface3,
      contentTextStyle: TextStyle(color: kTextPrimary),
    ),
    textTheme: base.textTheme.apply(
      bodyColor: kTextPrimary,
      displayColor: kTextPrimary,
    ),
  );
}

/// Fondo con un halo carmesí sutil, para no caer en el típico negro plano.
class AriaBackground extends StatelessWidget {
  const AriaBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0.75, -1.1),
          radius: 1.3,
          colors: [Color(0x26FF2E4D), Color(0x0008080B)],
        ),
        color: kBg,
      ),
      child: child,
    );
  }
}
