import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Marca de ARIA: una "A" neuronal (nodos y conexiones), carmesí.
class AriaLogo extends StatelessWidget {
  const AriaLogo({super.key, this.size = 64});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(painter: _AriaMarkPainter()),
    );
  }
}

class _AriaMarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    final stroke = Paint()
      ..color = kAccent
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.07
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final a = Path()
      ..moveTo(w * 0.22, h * 0.82)
      ..lineTo(w * 0.5, h * 0.16)
      ..lineTo(w * 0.78, h * 0.82);
    canvas.drawPath(a, stroke);
    canvas.drawLine(
      Offset(w * 0.34, h * 0.62),
      Offset(w * 0.66, h * 0.62),
      stroke,
    );

    final node = Paint()..color = kAccent;
    final nodes = [
      Offset(w * 0.5, h * 0.16),
      Offset(w * 0.22, h * 0.82),
      Offset(w * 0.78, h * 0.82),
      Offset(w * 0.34, h * 0.62),
      Offset(w * 0.66, h * 0.62),
    ];
    for (final o in nodes) {
      canvas.drawCircle(o, w * 0.035, node);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
