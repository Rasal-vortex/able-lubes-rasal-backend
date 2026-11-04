import { ApiError } from "./errors.js";

export type QuantityUnit = { name: string; allowsDecimals: boolean };

const decimalPlaces = (value: number | string) => {
  const text = String(value).toLowerCase();
  const [coefficient, exponentText] = text.split("e");
  const fractionLength = coefficient.split(".")[1]?.length ?? 0;
  return Math.max(0, fractionLength - Number(exponentText ?? 0));
};

export function validateQuantity(
  quantity: number | string,
  unit: QuantityUnit,
  options: { allowZero?: boolean } = {},
) {
  const value = Number(quantity);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    (!options.allowZero && value === 0)
  )
    throw new ApiError(
      400,
      options.allowZero
        ? "Quantity must be a non-negative finite number"
        : "Quantity must be a positive finite number",
    );
  if (decimalPlaces(quantity) > 3)
    throw new ApiError(400, "Quantity may have at most three decimal places");
  if (!unit.allowsDecimals && !Number.isInteger(value))
    throw new ApiError(400, `${unit.name} quantities must be whole numbers`);
}
