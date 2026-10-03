import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'state/chat_controller.dart';
import 'theme/app_theme.dart';
import 'widgets/aria_logo.dart';

void main() {
  runApp(const AriaApp());
}

class AriaApp extends StatelessWidget {
  const AriaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<ChatController>(
      create: (_) => ChatController()..init(),
      child: MaterialApp(
        title: 'ARIA',
        debugShowCheckedModeBanner: false,
        theme: buildAriaTheme(),
        home: const RootGate(),
      ),
    );
  }
}

class RootGate extends StatelessWidget {
  const RootGate({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<ChatController>().authState;
    switch (state) {
      case AuthState.checking:
        return const _SplashScreen();
      case AuthState.needed:
        return const LoginScreen();
      case AuthState.ready:
        return const HomeScreen();
    }
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: kBg,
      body: AriaBackground(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AriaLogo(size: 64),
              SizedBox(height: 18),
              SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: kAccent,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
