import { describe, expect, it } from "vitest";
import { cropStyles, dragCrop, fitRatio, FULL_CROP, parseCrop, parseWidth, resizedWidth, widthAfterCrop } from "../src/editor/imageGeometry";

describe("image width", () => {
  it("grows with the right handle and shrinks with the left one, twice as fast when centred", () => {
    expect(resizedWidth(400, 50, "right", "left", 800)).toBe(450);
    expect(resizedWidth(400, 50, "left", "left", 800)).toBe(350);
    expect(resizedWidth(400, -50, "left", "right", 800)).toBe(450);
    expect(resizedWidth(400, 50, "right", "center", 800)).toBe(500);
  });

  it("stays between the smallest width and the page's", () => {
    expect(resizedWidth(400, -1000, "right", "left", 800)).toBe(48);
    expect(resizedWidth(400, 1000, "right", "left", 800)).toBe(800);
  });

  it("is a whole number of pixels, or none", () => {
    expect(parseWidth(320.6)).toBe(321);
    expect(parseWidth("250")).toBe(250);
    expect(parseWidth(10)).toBeNull();
    expect(parseWidth("100%")).toBeNull();
    expect(parseWidth(null)).toBeNull();
  });

  it("keeps the image's scale when its crop changes", () => {
    const half = { ...FULL_CROP(2), w: 0.5 };
    expect(widthAfterCrop(600, null, half)).toBe(300);
    expect(widthAfterCrop(300, half, null)).toBe(600);
  });
});

describe("image crop", () => {
  it("is read back checked, the whole image being no crop", () => {
    expect(parseCrop('{"x":0.1,"y":0.2,"w":0.5,"h":0.5,"r":1.5}')).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.5, r: 1.5 });
    expect(parseCrop({ x: 0, y: 0, w: 1, h: 1, r: 1 })).toBeNull();
    expect(parseCrop({ x: 0.8, y: 0, w: 0.5, h: 1, r: 1 })).toBeNull();
    expect(parseCrop({ x: 0, y: 0, w: 0.5, h: 1 })).toBeNull();
    expect(parseCrop("not json")).toBeNull();
  });

  it("is drawn as a box of its shape with the image moved inside", () => {
    const s = cropStyles({ x: 0.25, y: 0.5, w: 0.5, h: 0.5, r: 2 });
    expect(s.box.aspectRatio).toBe("1 / 0.5");
    expect(s.image).toEqual({ width: "200%", height: "200%", left: "-50%", top: "-100%" });
  });

  it("moves inside the image and resizes from the opposite side", () => {
    const c = { x: 0.2, y: 0.2, w: 0.5, h: 0.5, r: 1 };
    expect(dragCrop(c, "move", 0.5, -0.5)).toEqual({ ...c, x: 0.5, y: 0 });
    const right = dragCrop(c, "e", 0.1, 0.3);
    expect(right.x).toBe(0.2);
    expect(right.w).toBeCloseTo(0.6);
    expect(right.h).toBe(0.5);
    const nw = dragCrop(c, "nw", -0.1, -0.5);
    expect(nw.x).toBeCloseTo(0.1);
    expect(nw.y).toBe(0);
    expect(nw.x + nw.w).toBeCloseTo(0.7);
    expect(nw.y + nw.h).toBeCloseTo(0.7);
    // Never smaller than the smallest crop.
    expect(dragCrop(c, "se", -1, -1).w).toBe(0.05);
  });

  it("keeps a locked shape on the corners and fits a new shape inside", () => {
    const whole = FULL_CROP(2);
    const square = fitRatio(whole, 1);
    expect(square).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1, r: 2 });
    const smaller = dragCrop(square, "se", -0.25, 0, 1);
    expect(smaller.w).toBeCloseTo(0.25);
    expect(smaller.h).toBeCloseTo(0.5);
    // Shape on screen: width × ratio / height.
    expect((smaller.w * smaller.r) / smaller.h).toBeCloseTo(1);
  });
});
