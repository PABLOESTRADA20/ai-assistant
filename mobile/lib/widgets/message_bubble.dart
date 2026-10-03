import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

import '../models/models.dart';
import '../theme/app_theme.dart';

class MessageBubble extends StatelessWidget {
  const MessageBubble({super.key, required this.message, this.streaming = false});

  final Message message;
  final bool streaming;

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == 'user';
    final maxWidth = MediaQuery.of(context).size.width * 0.85;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: maxWidth),
        margin: const EdgeInsets.symmetric(vertical: 6, horizontal: 12),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: isUser ? kAccent.withOpacity(0.16) : kSurface2,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isUser ? kAccent.withOpacity(0.35) : kBorder,
          ),
        ),
        child: isUser
            ? SelectableText(
                message.content,
                style: const TextStyle(
                  color: kTextPrimary,
                  fontSize: 15,
                  height: 1.4,
                ),
              )
            : MarkdownBody(
                data: message.content.isEmpty
                    ? (streaming ? '…' : '')
                    : message.content,
                selectable: true,
                styleSheet: MarkdownStyleSheet(
                  p: const TextStyle(
                    color: kTextPrimary,
                    fontSize: 15,
                    height: 1.5,
                  ),
                  code: TextStyle(
                    backgroundColor: kSurface3,
                    color: kAccent,
                    fontFamily: 'monospace',
                    fontSize: 13,
                  ),
                  codeblockDecoration: BoxDecoration(
                    color: kSurface3,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  blockquoteDecoration: const BoxDecoration(
                    border: Border(
                      left: BorderSide(color: kAccent, width: 3),
                    ),
                  ),
                  a: const TextStyle(color: kAccent),
                ),
              ),
      ),
    );
  }
}
