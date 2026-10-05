import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Marca de ARIA: inspirado en el logo neuronal de la web (A con ramificaciones).
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

    final strokeMain = Paint()
      ..color = kAccent
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.06
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final strokeSub = Paint()
      ..color = kAccent.withOpacity(0.28)
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.035
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    // A principal
    final a = Path()
      ..moveTo(w * 0.22, h * 0.86)
      ..lineTo(w * 0.5, h * 0.12)
      ..lineTo(w * 0.78, h * 0.86);
    canvas.drawPath(a, strokeMain);

    // barra central
    canvas.drawLine(
      Offset(w * 0.36, h * 0.64),
      Offset(w * 0.64, h * 0.64),
      strokeMain,
    );

    // ramificaciones neuronales (como en icon.svg)
    canvas.drawLine(
      Offset(w * 0.5, h * 0.12),
      Offset(w * 0.5, h * 0.04),
      strokeSub,
    );
    canvas.drawLine(
      Offset(w * 0.22, h * 0.86),
      Offset(w * 0.13, h * 0.91),
      strokeSub,
    );
    canvas.drawLine(
      Offset(w * 0.78, h * 0.86),
      Offset(w * 0.87, h * 0.91),
      strokeSub,
    );

    final node = Paint()..color = kAccent;
    final nodes = [
      Offset(w * 0.5, h * 0.12),
      Offset(w * 0.22, h * 0.86),
      Offset(w * 0.78, h * 0.86),
      Offset(w * 0.36, h * 0.64),
      Offset(w * 0.64, h * 0.64),
      Offset(w * 0.5, h * 0.04),
      Offset(w * 0.13, h * 0.91),
      Offset(w * 0.87, h * 0.91),
    ];
    for (final o in nodes) {
      canvas.drawCircle(o, w * 0.032, node);
    }
    final nodeCore = Paint()..color = Colors.white;
    canvas.drawCircle(nodes[0], w * 0.013, nodeCore);
    canvas.drawCircle(nodes[1], w * 0.011, nodeCore);
    canvas.drawCircle(nodes[2], w * 0.011, nodeCore);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
