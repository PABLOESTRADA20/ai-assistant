import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../api/aria_api.dart';
import '../models/models.dart';

enum AuthState { checking, needed, ready }

class ChatController extends ChangeNotifier {
  static const _tokenKey = 'aria_access_token';
  static const _modelKey = 'aria_model';

  final Uuid _uuid = const Uuid();

  AuthState authState = AuthState.checking;
  bool loading = true;
  bool sending = false;
  String streaming = '';
  String model = defaultModelId;
  List<AIModel> models = List.of(availableModels);
  String? error;
  String? notice;

  final List<Conversation> conversations = [];
  String? activeId;

  AriaApi? _api;
  http.Client? _client;

  Conversation? get active {
    for (final c in conversations) {
      if (c.id == activeId) return c;
    }
    return null;
  }

  List<Message> get messages => active?.messages ?? const [];

  Future<void> init() async {
    final api = AriaApi();
    _api = api;
    final prefs = await SharedPreferences.getInstance();
    model = prefs.getString(_modelKey) ?? defaultModelId;
    final savedToken = prefs.getString(_tokenKey);

    final required = await api.authRequired();
    if (!required) {
      api.token = savedToken;
      authState = AuthState.ready;
      notifyListeners();
      unawaited(_loadModels());
      await _loadConversations();
      return;
    }

    if (savedToken == null || savedToken.isEmpty) {
      authState = AuthState.needed;
      notifyListeners();
      return;
    }

    api.token = savedToken;
    bool ok;
    try {
      ok = await api.verifyToken(savedToken);
    } catch (_) {
      // Sin red: dejamos entrar con el token guardado.
      ok = true;
    }
    if (ok) {
      authState = AuthState.ready;
      notifyListeners();
      unawaited(_loadModels());
      await _loadConversations();
    } else {
      authState = AuthState.needed;
      notifyListeners();
    }
  }

  /// Devuelve `null` si la clave sirvió, o un mensaje de error.
  Future<String?> login(String token) async {
    final api = _api ??= AriaApi();
    final value = token.trim();
    if (value.isEmpty) return 'Ingresá la clave de acceso.';
    try {
      final ok = await api.verifyToken(value);
      if (!ok) return 'La clave no es correcta.';
    } catch (_) {
      return 'No se pudo validar la clave. Revisá la conexión.';
    }
    api.token = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, value);
    authState = AuthState.ready;
    notifyListeners();
    unawaited(_loadModels());
    await _loadConversations();
    return null;
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    _api?.token = null;
    conversations.clear();
    activeId = null;
    authState = AuthState.needed;
    notifyListeners();
  }

  Future<void> _loadConversations() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final list = await _api!.getConversations();
      conversations
        ..clear()
        ..addAll(list);
      if (activeId == null && conversations.isNotEmpty) {
        activeId = conversations.first.id;
      }
    } on UnauthorizedException {
      await logout();
      return;
    } catch (e) {
      error = e.toString();
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> refresh() => _loadConversations();

  Future<void> newConversation() async {
    try {
      final conv = await _api!.createConversation(model);
      conversations.insert(0, conv);
      activeId = conv.id;
      notifyListeners();
    } catch (e) {
      error = e.toString();
      notifyListeners();
    }
  }

  void select(String id) {
    activeId = id;
    notifyListeners();
  }

  Future<void> deleteConversation(String id) async {
    try {
      await _api!.deleteConversation(id);
      conversations.removeWhere((c) => c.id == id);
      if (activeId == id) {
        activeId = conversations.isEmpty ? null : conversations.first.id;
      }
      notifyListeners();
    } catch (e) {
      error = e.toString();
      notifyListeners();
    }
  }

  Future<void> setModel(String value) async {
    model = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_modelKey, value);
    notifyListeners();
  }

  /// Trae del servidor los modelos que pueden responder y actualiza la lista.
  /// Si falla, se queda con la lista local (los modelos base).
  Future<void> _loadModels() async {
    try {
      final remote = await _api!.getModels();
      if (remote.isEmpty) return;
      models = remote;
      if (!models.any((m) => m.id == model)) {
        model = models.first.id;
      }
      notifyListeners();
    } catch (_) {
      // Sin conexión: se mantiene la lista local.
    }
  }

  /// Nombre visible de un modelo (o el id si no se conoce).
  String modelLabel(String id) {
    for (final m in models) {
      if (m.id == id) return m.name;
    }
    for (final m in availableModels) {
      if (m.id == id) return m.name;
    }
    return id;
  }

  void clearError() {
    error = null;
    notifyListeners();
  }

  /// Detiene la respuesta en curso.
  void stop() {
    _client?.close();
    _client = null;
    sending = false;
    notifyListeners();
  }

  Future<void> send(String text) async {
    final content = text.trim();
    if (content.isEmpty || sending) return;

    var conv = active;
    if (conv == null) {
      await newConversation();
      conv = active;
      if (conv == null) return;
    }

    final userMessage = Message(
      id: _uuid.v4(),
      role: 'user',
      content: content,
    );
    final isFirst = conv.messages.isEmpty;
    final updated = [...conv.messages, userMessage];
    _replace(
      conv.id,
      conv.copyWith(
        messages: updated,
        title: isFirst ? _titleFrom(content) : null,
        updatedAt: DateTime.now(),
      ),
    );
    sending = true;
    streaming = '';
    notifyListeners();

    _client = http.Client();
    try {
      final result = await _api!.streamChat(
        messages: updated,
        model: model,
        conversationId: conv.id,
        client: _client!,
        onContent: (acc) {
          streaming = acc;
          notifyListeners();
        },
        onModelSwitch: (from, to) {
          notice = '${modelLabel(from)} no ejecuta herramientas. Pasé a ${modelLabel(to)}.';
          notifyListeners();
          unawaited(Future.delayed(const Duration(seconds: 8), () {
            if (notice != null) {
              notice = null;
              notifyListeners();
            }
          }));
        },
      );

      final assistant = Message(
        id: _uuid.v4(),
        role: 'assistant',
        content: result.content,
        model: result.model,
      );
      final finalMessages = [...updated, assistant];
      _replace(
        conv.id,
        conv.copyWith(
          messages: finalMessages,
          model: result.model,
          updatedAt: DateTime.now(),
        ),
      );
      streaming = '';
      if (result.switched) model = result.model;
      notifyListeners();

      try {
        await _api!.updateConversation(
          conv.id,
          messages: finalMessages,
          model: result.model,
        );
      } catch (_) {
        // Aunque falle el guardado, la respuesta ya está en pantalla.
      }
    } on UnauthorizedException {
      await logout();
    } catch (e) {
      final msg = e.toString();
      if (!msg.contains('ClientException') && !msg.toLowerCase().contains('closed')) {
        error = msg;
      }
    } finally {
      sending = false;
      _client = null;
      notifyListeners();
    }
  }

  void _replace(String id, Conversation conv) {
    final i = conversations.indexWhere((c) => c.id == id);
    if (i >= 0) conversations[i] = conv;
  }

  static String _titleFrom(String text) {
    final clean = text.replaceAll(RegExp(r'\s+'), ' ').trim();
    return clean.length <= 48 ? clean : '${clean.substring(0, 48)}…';
  }
}
