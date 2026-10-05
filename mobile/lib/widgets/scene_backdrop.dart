import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../api/aria_api.dart';
import '../theme/app_theme.dart';

/// Permite mandar comandos a la escena 3D desde los botones de Flutter
/// (el HUD del HTML va oculto cuando la escena vive dentro de la app).
class SceneHandle {
  void Function(String js)? _run;

  bool get ready => _run != null;

  void run(String js) => _run?.call(js);

  void reset() => run('window.ariaScene && window.ariaScene.reset()');
  void toggleHolograma() => run('window.ariaScene && window.ariaScene.holo()');
  void toggleLuz() => run('window.ariaScene && window.ariaScene.light()');
  void toggleGrid() => run('window.ariaScene && window.ariaScene.grid()');
}

/// Escena 3D de ARIA (Three.js) como fondo del chat.
///
/// Three.js es JavaScript, asi que corre dentro de un WebView. Se carga desde
/// el propio dominio del Worker con `bg=0` (fondo transparente) y `hud=0`
/// (sin botones propios, porque los maneja Flutter).
class SceneBackdrop extends StatefulWidget {
  const SceneBackdrop({super.key, required this.handle});

  final SceneHandle handle;

  @override
  State<SceneBackdrop> createState() => _SceneBackdropState();
}

class _SceneBackdropState extends State<SceneBackdrop> {
  late final WebViewController _controller;
  bool _fallo = false;
  bool _cargando = true;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      // Transparente para que se vea el chat de ARIA encima.
      ..setBackgroundColor(const Color(0x00000000))
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            if (mounted) setState(() => _cargando = false);
          },
          onWebResourceError: (_) {
            // Si la escena falla, el chat sigue funcionando igual.
            if (mounted) {
              setState(() {
                _fallo = true;
                _cargando = false;
              });
            }
          },
        ),
      )
      ..loadRequest(Uri.parse('$kBaseUrl/cyberpunk?bg=0&hud=0'));

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