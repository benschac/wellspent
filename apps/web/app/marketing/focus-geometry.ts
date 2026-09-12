import * as THREE from "three";

export function roundedRail(
  width: number,
  height: number,
  radius: number,
  depth: number,
) {
  const shape = new THREE.Shape();
  const x = -width / 2,
    y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 6,
    steps: 1,
    bevelSize: 0.065,
    bevelThickness: 0.08,
    curveSegments: 32,
  });
}

export function neckGeometry(dx: number, dy: number) {
  const shape = new THREE.Shape();
  const right = 1.85 + dx;
  const middle = 0.2 + dy;
  shape.moveTo(right, middle + 0.85);
  shape.bezierCurveTo(
    right + 0.85,
    middle - 0.05,
    3.45,
    middle - 0.12,
    3.45,
    middle + 2.15,
  );
  shape.lineTo(3.45, middle - 2.15);
  shape.bezierCurveTo(
    3.45,
    middle + 0.1,
    right + 0.75,
    middle - 0.25,
    right,
    middle - 0.85,
  );
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.16,
    bevelEnabled: true,
    bevelSize: 0.035,
    bevelThickness: 0.05,
    bevelSegments: 4,
    curveSegments: 28,
  });
}
