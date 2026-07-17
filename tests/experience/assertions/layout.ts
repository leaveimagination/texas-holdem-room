import { EXPERIENCE_THRESHOLDS } from "../evidence/contracts";
import {
  assertProductCondition,
  type MechanicalAssertionContext
} from "../support/experience-test";

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  left: number;
  top: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface HitTestElement {
  contains(node: HitTestElement): boolean;
}

export interface CenterPointHitResult {
  point: Point;
  targetElement: HitTestElement;
  elementFromPoint: HitTestElement | null;
}

export interface SeatingLayoutRenderFacts {
  expectedSeatCount: number;
  feltRendered: boolean;
  renderedSeatCount: number;
  localSeatRendered: boolean;
}

export function hasMinimumHitTarget(
  size: Size,
  minimumPx = EXPERIENCE_THRESHOLDS.mobileHitTargetPx
): boolean {
  return size.width >= minimumPx && size.height >= minimumPx;
}

export function hasViewportOverflow(dimensions: {
  scrollWidth: number;
  clientWidth: number;
}): boolean {
  return dimensions.scrollWidth > dimensions.clientWidth;
}

export function centerPoint(rect: Rect): Point {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

export function centerPointHitsTarget(
  target: Rect,
  hit: CenterPointHitResult
): boolean {
  const expectedPoint = centerPoint(target);
  const elementHit = hit.elementFromPoint !== null && (
    hit.elementFromPoint === hit.targetElement ||
    hit.targetElement.contains(hit.elementFromPoint)
  );
  return hit.point.x === expectedPoint.x &&
    hit.point.y === expectedPoint.y &&
    elementHit;
}

export function assertMinimumHitTarget(
  size: Size,
  context: MechanicalAssertionContext
): void {
  assertProductCondition(hasMinimumHitTarget(size), {
    ...context,
    earliestDivergentProjection: null,
    measuredValue: size,
    threshold: {
      width: EXPERIENCE_THRESHOLDS.mobileHitTargetPx,
      height: EXPERIENCE_THRESHOLDS.mobileHitTargetPx
    }
  });
}

export function assertNoViewportOverflow(
  dimensions: { scrollWidth: number; clientWidth: number },
  context: MechanicalAssertionContext
): void {
  assertProductCondition(!hasViewportOverflow(dimensions), {
    ...context,
    earliestDivergentProjection: null,
    measuredValue: dimensions.scrollWidth,
    threshold: dimensions.clientWidth
  });
}

export function assertCenterPointHit(
  target: Rect,
  hit: CenterPointHitResult,
  context: MechanicalAssertionContext
): void {
  const targetOrDescendantHit = hit.elementFromPoint !== null && (
    hit.elementFromPoint === hit.targetElement ||
    hit.targetElement.contains(hit.elementFromPoint)
  );
  assertProductCondition(centerPointHitsTarget(target, hit), {
    ...context,
    earliestDivergentProjection: null,
    measuredValue: { point: hit.point, targetOrDescendantHit },
    threshold: { point: centerPoint(target), targetOrDescendantHit: true }
  });
}

export function assertSeatingLayoutRendered(
  facts: SeatingLayoutRenderFacts,
  context: MechanicalAssertionContext
): void {
  assertProductCondition(
    facts.feltRendered &&
      facts.renderedSeatCount === facts.expectedSeatCount &&
      facts.localSeatRendered,
    {
      ...context,
      earliestDivergentProjection: null,
      measuredValue: facts,
      threshold: {
        feltRendered: true,
        renderedSeatCount: facts.expectedSeatCount,
        localSeatRendered: true
      }
    }
  );
}
