import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../state/chat_controller.dart';
import '../theme/app_theme.dart';
import '../widgets/aria_logo.dart';
import '../widgets/chat_input.dart';
import '../widgets/message_bubble.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final ScrollController _scroll = ScrollController();
  int _lastCount = 0;
  int _lastStreamLen = 0;

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _confirmDelete(ChatController c, String id, String title) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Eliminar conversación'),
        content: Text('¿Eliminar "$title"? Esta acción no se puede deshacer.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: kAccent),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (ok == true) await c.deleteConversation(id);
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.watch<ChatController>();
    final messages = c.messages;
    final total = messages.length + (c.sending ? 1 : 0);

    if (total != _lastCount || c.streaming.length != _lastStreamLen) {
      _lastCount = total;
      _lastStreamLen = c.streaming.length;
      _scrollToBottom();
    }

    return Scaffold(
      backgroundColor: kBg,
      drawer: _buildDrawer(context, c),
      appBar: AppBar(
        title: Text(
          c.active?.title ?? 'ARIA',
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
        ),
        actions: [
          _buildModelButton(context, c),
          IconButton(
            tooltip: 'Recargar',
            onPressed: c.loading ? null : c.refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: AriaBackground(
        child: Column(
          children: [
            if (c.error != null) _buildError(context, c),
            if (c.notice != null) _buildNotice(c.notice!),
            Expanded(
              child: c.loading && messages.isEmpty
                  ? const Center(
                      child: CircularProgressIndicator(color: kAccent),
                    )
                  : messages.isEmpty && !c.sending
                      ? _buildWelcome(context, c)
                      : ListView.builder(
                          controller: _scroll,
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          itemCount: total,
                          itemBuilder: (context, i) {
                            if (i < messages.length) {
                              return MessageBubble(message: messages[i]);
                            }
                            return MessageBubble(
                              message: Message(
                                id: '__streaming__',
                                role: 'assistant',
                                content: c.streaming,
                              ),
                              streaming: true,
                            );
                          },
                        ),
            ),
            ChatInput(
              sending: c.sending,
              onSend: c.send,
              onStop: c.stop,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildModelButton(BuildContext context, ChatController c) {
    return PopupMenuButton<String>(
      tooltip: 'Elegir modelo',
      initialValue: c.model,
      onSelected: c.setModel,
      color: kSurface2,
      itemBuilder: (context) => c.models
          .map(
            (m) => PopupMenuItem<String>(
              value: m.id,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      Text(m.name, style: const TextStyle(color: kTextPrimary)),
                      if (m.id == c.model) ...[
                        const SizedBox(width: 6),
                        const Icon(Icons.check, size: 14, color: kAccent),
                      ],
                    ],
                  ),
                  Text(
                    m.description,
                    style: const TextStyle(color: kTextMuted, fontSize: 11),
                  ),
                ],
              ),
            ),
          )
          .toList(),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.memory, size: 15, color: kAccent),
            const SizedBox(width: 6),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 110),
              child: Text(
                c.modelLabel(c.model),
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: kTextSecondary, fontSize: 12),
              ),
            ),
            const Icon(Icons.arrow_drop_down, size: 18, color: kTextMuted),
          ],
        ),
      ),
    );
  }

  Widget _buildError(BuildContext context, ChatController c) {
    return Container(
      width: double.infinity,
      color: const Color(0x33FF2E4D),
      padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
      child: Row(
        children: [
          const Icon(Icons.error_outline, size: 18, color: kAccent),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              c.error!,
              style: const TextStyle(color: kTextPrimary, fontSize: 13),
            ),
          ),
          IconButton(
            onPressed: c.clearError,
            icon: const Icon(Icons.close, size: 16, color: kTextMuted),
          ),
        ],
      ),
    );
  }

  Widget _buildNotice(String text) {
    return Container(
      width: double.infinity,
      color: kSurface2,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      child: Row(
        children: [
          const Icon(Icons.swap_horiz, size: 16, color: kAccent),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(color: kTextSecondary, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWelcome(BuildContext context, ChatController c) {
    const suggestions = [
      '¿En qué me podés ayudar?',
      'Resumime las noticias de hoy',
      'Escribime un correo profesional',
      'Explicame un concepto difícil',
    ];
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          const SizedBox(height: 24),
          const AriaLogo(size: 64),
          const SizedBox(height: 16),
          const Text(
            'Hola, soy ARIA',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          const Text(
            'Preguntá lo que quieras. Tengo memoria, herramientas y voz.',
            textAlign: TextAlign.center,
            style: TextStyle(color: kTextMuted),
          ),
          const SizedBox(height: 24),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: WrapAlignment.center,
            children: suggestions
                .map(
                  (s) => ActionChip(
                    label: Text(s),
                    backgroundColor: kSurface2,
                    side: const BorderSide(color: kBorder),
                    labelStyle: const TextStyle(color: kTextSecondary, fontSize: 12),
                    onPressed: c.sending ? null : () => c.send(s),
                  ),
                )
                .toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildDrawer(BuildContext context, ChatController c) {
    return Drawer(
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Row(
                children: [
                  const AriaLogo(size: 34),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Text(
                      'ARIA',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 3,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Cerrar sesión',
                    onPressed: c.logout,
                    icon: const Icon(Icons.logout, size: 18, color: kTextMuted),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () {
                    Navigator.pop(context);
                    c.newConversation();
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: kAccent,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Nueva conversación'),
                ),
              ),
            ),
            const Divider(height: 24),
            Expanded(
              child: c.conversations.isEmpty
                  ? const Center(
                      child: Text(
                        'Sin conversaciones',
                        style: TextStyle(color: kTextMuted),
                      ),
                    )
                  : ListView.builder(
                      itemCount: c.conversations.length,
                      itemBuilder: (context, i) {
                        final conv = c.conversations[i];
                        final selected = conv.id == c.activeId;
                        return ListTile(
                          selected: selected,
                          selectedTileColor: kAccent.withOpacity(0.12),
                          leading: Icon(
                            Icons.chat_bubble_outline,
                            size: 18,
                            color: selected ? kAccent : kTextMuted,
                          ),
                          title: Text(
                            conv.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: selected ? kTextPrimary : kTextSecondary,
                              fontSize: 14,
                            ),
                          ),
                          onTap: () {
                            c.select(conv.id);
                            Navigator.pop(context);
                          },
                          onLongPress: () =>
                              _confirmDelete(c, conv.id, conv.title),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
