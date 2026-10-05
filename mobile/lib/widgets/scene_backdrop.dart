import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../api/aria_api.dart';
import '../theme/app_theme.dart';

/// Solo para Android (y web). En Windows usamos el anterior sin WebView o
/// lo mostramos inline de otra manera; pero el pedido es que el PC quede con
/// el codigo anterior.
class SceneHandle {
  void Function(String js)? _run;

  bool get ready => _run != null;

  void run(String js) => _run?.call(js);

  void reset() => run('window.ariaScene && window.ariaScene.reset()');
  void toggleHolograma() => run('window.ariaScene && window.ariaScene.holo()');
  void toggleLuz() => run('window.ariaScene && window.ariaScene.light()');
  void toggleGrid() => run('window.ariaScene && window.ariaScene.grid()');
}

class SceneBackdrop extends StatelessWidget {
  const SceneBackdrop({super.key, required this.handle});

  final SceneHandle handle;

  @override
  Widget build(BuildContext context) {
    if (kIsWeb) {
      // En web carga el HTML directamente.
      return _SceneWebView(handle: handle);
    }
    if (Platform.isWindows || Platform.isMacOS || Platform.isLinux) {
      // En escritorio NO usamos WebView. Devolvemos un gradiente oscuro y
      // mantenemos el resto de la UI tal cual estaba antes.
      return const DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0.75, -0.4),
            radius: 1.2,
            colors: [Color(0x26FF2E4D), Color(0x0008080B)],
          ),
          color: kBg,
        ),
      );
    }
    return _SceneWebView(handle: handle);
  }
}

class _SceneWebView extends StatefulWidget {
  const _SceneWebView({required this.handle});

  final SceneHandle handle;

  @override
  State<_SceneWebView> createState() => _SceneWebViewState();
}

class _SceneWebViewState extends State<_SceneWebView> {
  late final WebViewController _controller;
  bool _fallo = false;
  bool _cargando = true;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0x00000000))
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            if (mounted) setState(() => _cargando = false);
          },
          onWebResourceError: (_) {
            if (mounted) {
              setState(() {
                _fallo = true;
                _cargando = false;
              });
            }
          },
        ),
      )
      ..loadRequest(Uri.parse('$kBaseUrl/cyberpunk-bg?bg=0'));

    widget.handle._run = (js) => _controller.runJavaScript(js);
  }

  @override
  void dispose() {
    widget.handle._run = null;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_fallo) return const SizedBox.shrink();
    return Stack(
      fit: StackFit.expand,
      children: [
        WebViewWidget(controller: _controller),
        if (_cargando)
          const DecoratedBox(
            decoration: BoxDecoration(color: kBg),
            child: Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: kAccent,
                ),
              ),
            ),
          ),
      ],
    );
  }
}