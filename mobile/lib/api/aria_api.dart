import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/models.dart';

/// Servidor de ARIA (Cloudflare Worker). El backend no cambia: la app solo
/// consume la misma API que la versión web.
const String kBaseUrl =
    'https://ai-assistant.pablo-maximiliano-cocio-estrada.workers.dev';

/// Orden de reintento cuando un modelo se queda sin cuota.
const List<String> kFallbackOrder = [
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
];

class UnauthorizedException implements Exception {
  @override
  String toString() => 'No autorizado';
}

class ChatStreamResult {
  final String content;
  final String model;
  final bool switched;

  ChatStreamResult({
    required this.content,
    required this.model,
    required this.switched,
  });
}

class AriaApi {
  AriaApi({this.token});

  String? token;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (token != null && token!.isNotEmpty) 'Authorization': 'Bearer $token',
      };

  /// ¿La app exige clave? Endpoint público.
  Future<bool> authRequired() async {
    try {
      final res = await http
          .get(Uri.parse('$kBaseUrl/api/auth'))
          .timeout(const Duration(seconds: 10));
      if (res.statusCode != 200) return false;
      final data = jsonDecode(utf8.decode(res.bodyBytes));
      return data is Map && data['required'] == true;
    } catch (_) {
      return false;
    }
  }

  /// Comprueba la clave contra una ruta protegida.
  Future<bool> verifyToken(String value) async {
    final res = await http.get(
      Uri.parse('$kBaseUrl/api/conversations'),
      headers: {'Authorization': 'Bearer $value'},
    ).timeout(const Duration(seconds: 15));
    if (res.statusCode == 401) return false;
    return res.statusCode == 200;
  }

  /// Catalogo de modelos disponibles en el servidor (publico). Devuelve solo
  /// los que pueden responder: los gratis sin clave y los que ya tienen clave.
  Future<List<AIModel>> getModels() async {
    final res = await http
        .get(Uri.parse('$kBaseUrl/api/models'))
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) return const [];
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    final raw = (data is Map ? data['models'] : data);
    if (raw is! List) return const [];
    final out = <AIModel>[];
    for (final item in raw) {
      if (item is! Map) continue;
      final m = Map<String, dynamic>.from(item);
      if (m['available'] == false) continue;
      out.add(
        AIModel(
          id: (m['id'] ?? '').toString(),
          name: (m['name'] ?? '').toString(),
          description: (m['description'] ?? '').toString(),
          badge: (m['badge'] ?? '').toString(),
        ),
      );
    }
    return out;
  }

  Future<List<Conversation>> getConversations() async {
    final res = await http.get(
      Uri.parse('$kBaseUrl/api/conversations'),
      headers: _headers,
    ).timeout(const Duration(seconds: 20));
    if (res.statusCode == 401) throw UnauthorizedException();
    if (res.statusCode != 200) {
      throw Exception('No se pudieron cargar las conversaciones (${res.statusCode}).');
    }
    final list = jsonDecode(utf8.decode(res.bodyBytes)) as List<dynamic>;
    return list
        .whereType<Map<String, dynamic>>()
        .map(Conversation.fromJson)
        .toList();
  }

  Future<Conversation> createConversation(String model) async {
    final res = await http.post(
      Uri.parse('$kBaseUrl/api/conversations'),
      headers: _headers,
      body: jsonEncode({'model': model}),
    ).timeout(const Duration(seconds: 20));
    if (res.statusCode == 401) throw UnauthorizedException();
    if (res.statusCode >= 300) {
      throw Exception('No se pudo crear la conversación (${res.statusCode}).');
    }
    return Conversation.fromJson(
      jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>,
    );
  }

  Future<void> updateConversation(
    String id, {
    String? title,
    List<Message>? messages,
    String? model,
  }) async {
    final body = <String, dynamic>{};
    if (title != null) body['title'] = title;
    if (model != null) body['model'] = model;
    if (messages != null) {
      body['messages'] = messages.map((m) => m.toJson()).toList();
    }
    final res = await http.put(
      Uri.parse('$kBaseUrl/api/conversations/$id'),
      headers: _headers,
      body: jsonEncode(body),
    ).timeout(const Duration(seconds: 30));
    if (res.statusCode == 401) throw UnauthorizedException();
    if (res.statusCode >= 300) {
      throw Exception('No se pudo guardar (${res.statusCode}).');
    }
  }

  Future<void> deleteConversation(String id) async {
    final res = await http.delete(
      Uri.parse('$kBaseUrl/api/conversations/$id'),
      headers: _headers,
    ).timeout(const Duration(seconds: 20));
    if (res.statusCode == 401) throw UnauthorizedException();
    if (res.statusCode >= 300) {
      throw Exception('No se pudo eliminar (${res.statusCode}).');
    }
  }

  /// Chat con streaming (SSE) y auto-cambio de modelo.
  Future<ChatStreamResult> streamChat({
    required List<Message> messages,
    required String model,
    String? conversationId,
    required void Function(String accumulated) onContent,
    required void Function(String from, String to) onModelSwitch,
    required http.Client client,
  }) async {
    final chain = <String>[model, ...kFallbackOrder.where((m) => m != model)];
    Object? lastError;

    for (var i = 0; i < chain.length; i++) {
      final candidate = chain[i];
      final request = http.Request('POST', Uri.parse('$kBaseUrl/api/chat'));
      request.headers.addAll(_headers);
      request.body = jsonEncode({
        'messages':
            messages.map((m) => {'role': m.role, 'content': m.content}).toList(),
        'model': candidate,
        if (conversationId != null) 'conversationId': conversationId,
      });

      final http.StreamedResponse streamed = await client.send(request);

      if (streamed.statusCode == 401) throw UnauthorizedException();

      if (streamed.statusCode >= 400) {
        final text = await streamed.stream.bytesToString();
        lastError = Exception(_extractError(text, streamed.statusCode));
        final isLast = i == chain.length - 1;
        if (!isLast && _retryable(streamed.statusCode, text)) {
          continue;
        }
        throw lastError;
      }

      var accumulated = '';
      var servedModel = candidate;
      final buffer = StringBuffer();

      void handleLine(String rawLine) {
        final line = rawLine.endsWith('\r')
            ? rawLine.substring(0, rawLine.length - 1)
            : rawLine;
        if (!line.startsWith('data: ')) return;
        final data = line.substring(6);
        if (data == '[DONE]') return;
        try {
          final parsed = jsonDecode(data);
          if (parsed is! Map<String, dynamic>) return;
          if (parsed['type'] == 'model_switch') {
            servedModel = (parsed['to'] ?? candidate).toString();
            onModelSwitch(
              (parsed['from'] ?? candidate).toString(),
              servedModel,
            );
          } else if (parsed['content'] != null) {
            accumulated += parsed['content'].toString();
            onContent(accumulated);
          }
        } catch (_) {
          // Fragmento malformado: se ignora.
        }
      }

      await for (final chunk in streamed.stream.transform(utf8.decoder)) {
        buffer.write(chunk);
        var pending = buffer.toString();
        var newline = pending.indexOf('\n');
        while (newline >= 0) {
          handleLine(pending.substring(0, newline));
          pending = pending.substring(newline + 1);
          newline = pending.indexOf('\n');
        }
        buffer
          ..clear()
          ..write(pending);
      }
      final tail = buffer.toString();
      if (tail.trim().isNotEmpty) handleLine(tail);

      return ChatStreamResult(
        content: accumulated,
        model: servedModel,
        switched: servedModel != model,
      );
    }

    throw lastError ?? Exception('Ningún modelo pudo responder. Probá de nuevo.');
  }
}

String _extractError(String body, int status) {
  try {
    final data = jsonDecode(body);
    if (data is Map && data['error'] is String) return data['error'] as String;
  } catch (_) {}
  return 'Error $status';
}

bool _retryable(int status, String text) {
  if (status == 429 || status == 502 || status == 503) return true;
  final t = text.toLowerCase();
  return t.contains('quota') ||
      t.contains('rate') ||
      t.contains('tokens per day') ||
      t.contains('neurons') ||
      t.contains('not configured') ||
      t.contains('binding ai');
}
