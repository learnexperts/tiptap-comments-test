import type { InferFixturesTypes } from "@vitest/runner";
import { type TestAPI } from "vitest";

export type Extension<Input = any, Output = any> = (
  input: TestAPI<Input>
) => TestAPI<Output>;

export type Extensions = readonly Extension[];

export type ApplyExtensionsResult<
  E extends Extensions,
  Input extends Record<string, any>
> = E extends readonly []
  ? TestAPI<Prettify<Input>>
  : E extends readonly [
      Extension<Input, infer Output>,
      ...infer Rest extends Extensions
    ]
  ? ApplyExtensionsResult<Rest, Input & Output>
  : never;

export default function applyExtensions<
  Extensions extends readonly Extension[],
  Input extends TestAPI
>(
  input: Input,
  extensions: Extensions
): ApplyExtensionsResult<Extensions, InferFixturesTypes<Input>> {
  return extensions.reduce(
    (test: any, extension) => extension(test),
    input
  ) as any;
}

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};
