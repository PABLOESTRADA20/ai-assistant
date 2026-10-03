# ARIA para Android (Flutter)

App nativa que consume la **misma API** del backend en Cloudflare. El servidor no
cambia.

## Estructura

```
mobile/
  pubspec.yaml
  lib/
    main.dart
    api/aria_api.dart        # cliente HTTP + streaming SSE
    models/models.dart       # modelos de datos y catálogo de modelos de IA
    state/chat_controller.dart
    theme/app_theme.dart
    screens/login_screen.dart
    screens/home_screen.dart
    widgets/...
```

## Compilar el APK

No hace falta tener Flutter instalado: el workflow
`.github/workflows/flutter-apk.yml` lo compila en GitHub Actions y publica el
`.apk` en **Releases**.

- Cada push a `main` que toque `mobile/**` genera una nueva versión.
- Descarga directa de la última: `https://github.com/PABLOESTRADA20/ai-assistant/releases/latest`
- También queda como artifact del workflow.

El APK va firmado con la clave de depuración (suficiente para instalarlo a mano).
Para publicar en Play Store habría que configurar una clave de release.

## Probar en local (opcional)

Con Flutter instalado:

```bash
cd mobile
flutter create --org com.pabloestrada --project-name aria_app --platforms=android .
flutter pub get
flutter run
```
