import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../api/aria_api.dart';
import '../theme/app_theme.dart';

/// Escena 3D de ARIA (Three.js). Se sirve desde el propio dominio del Worker
/// y se dibuja en un WebView, que es la unica forma de correr Three.js dentro
/// de Flutter sin reescribir la escena en un motor 3D nativo.
class SceneScreen extends StatefulWidget {
  const SceneScreen({super.key});

  @override
  State<SceneScreen> createState() => _SceneScreenState();
}

class _SceneScreenState extends State<SceneScreen> {
  late final WebViewController _controller;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(kBg)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            if (mounted) setState(() => _loading = false);
          },
          onWebResourceError: (e) {
            if (mounted) setState(() => _error = e.description);
          },
        ),
      )
      ..loadRequest(Uri.parse('$kBaseUrl/cyberpunk'));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          tooltip: 'Volver',
          onPressed: () => Navigator.pop(context),
          icon: const Icon(Icons.arrow_back, color: kTextPrimary),
        ),
      ),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_loading)
            const Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2, color: kAccent),
              ),
            ),
          if (_error != null)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  'No se pudo cargar la escena 3D.\n$_error',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: kTextMuted),
                ),
              ),
            ),
        ],
      ),
    );
  }
}