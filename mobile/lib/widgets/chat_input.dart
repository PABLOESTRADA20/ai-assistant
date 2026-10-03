import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class ChatInput extends StatefulWidget {
  const ChatInput({
    super.key,
    required this.onSend,
    required this.sending,
    required this.onStop,
  });

  final void Function(String text) onSend;
  final bool sending;
  final VoidCallback onStop;

  @override
  State<ChatInput> createState() => _ChatInputState();
}

class _ChatInputState extends State<ChatInput> {
  final TextEditingController _controller = TextEditingController();

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    _controller.clear();
    widget.onSend(text);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: _controller,
                minLines: 1,
                maxLines: 5,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(
                  hintText: 'Preguntá cualquier cosa…',
                  hintStyle: const TextStyle(color: kTextMuted),
                  filled: true,
                  fillColor: kSurface2,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: const BorderSide(color: kBorder),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: const BorderSide(color: kBorder),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            widget.sending
                ? IconButton.filled(
                    onPressed: widget.onStop,
                    style: IconButton.styleFrom(backgroundColor: kSurface3),
                    icon: const Icon(Icons.stop, color: kAccent),
                  )
                : IconButton.filled(
                    onPressed: _send,
                    style: IconButton.styleFrom(backgroundColor: kAccent),
                    icon: const Icon(Icons.send, color: Colors.white),
                  ),
          ],
        ),
      ),
    );
  }
}
