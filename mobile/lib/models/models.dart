// Modelos de datos de ARIA (espejo de app/types del frontend web).

const String defaultModelId = 'openai/gpt-oss-120b';

class AIModel {
  final String id;
  final String name;
  final String description;
  final String badge;

  const AIModel({
    required this.id,
    required this.name,
    required this.description,
    required this.badge,
  });
}

const List<AIModel> availableModels = [
  AIModel(
    id: 'openai/gpt-oss-120b',
    name: 'GPT-OSS 120B',
    description: 'Más inteligente • Uso general',
    badge: 'Recomendado',
  ),
  AIModel(
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen 3.8 27B',
    description: 'Razonamiento • Código complejo',
    badge: 'Código',
  ),
  AIModel(
    id: 'openai/gpt-oss-20b',
    name: 'GPT-OSS 20B',
    description: 'Ultra rápido • Con herramientas',
    badge: 'Rápido',
  ),
  AIModel(
    id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    name: 'DeepSeek R1 32B',
    description: 'Razonamiento profundo • gratis (sin herramientas)',
    badge: 'Gratis',
  ),
];

String modelName(String id) {
  for (final m in availableModels) {
    if (m.id == id) return m.name;
  }
  return id;
}

class Message {
  final String id;
  final String role; // 'user' | 'assistant'
  final String content;
  final String? model;

  const Message({
    required this.id,
    required this.role,
    required this.content,
    this.model,
  });

  factory Message.fromJson(Map<String, dynamic> json) {
    return Message(
      id: (json['id'] ?? '').toString(),
      role: (json['role'] ?? 'assistant').toString(),
      content: (json['content'] ?? '').toString(),
      model: json['model']?.toString(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'role': role,
      'content': content,
      'model': model,
      'createdAt': DateTime.now().toUtc().toIso8601String(),
    };
  }

  Message copyWith({String? content}) => Message(
        id: id,
        role: role,
        content: content ?? this.content,
        model: model,
      );
}

class Conversation {
  final String id;
  final String title;
  final String model;
  final List<Message> messages;
  final DateTime updatedAt;

  const Conversation({
    required this.id,
    required this.title,
    required this.model,
    required this.messages,
    required this.updatedAt,
  });

  factory Conversation.fromJson(Map<String, dynamic> json) {
    final raw = (json['messages'] as List<dynamic>?) ?? const [];
    return Conversation(
      id: (json['id'] ?? '').toString(),
      title: (json['title'] ?? 'Conversación').toString(),
      model: (json['model'] ?? defaultModelId).toString(),
      messages: raw
          .whereType<Map<String, dynamic>>()
          .map(Message.fromJson)
          .toList(),
      updatedAt: DateTime.tryParse((json['updatedAt'] ?? '').toString()) ??
          DateTime.now(),
    );
  }

  Conversation copyWith({
    String? title,
    String? model,
    List<Message>? messages,
    DateTime? updatedAt,
  }) =>
      Conversation(
        id: id,
        title: title ?? this.title,
        model: model ?? this.model,
        messages: messages ?? this.messages,
        updatedAt: updatedAt ?? this.updatedAt,
      );
}
