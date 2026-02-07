
export function toSnake(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(toSnake);
  }

  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        key.replace(/([A-Z])/g, "_$1").toLowerCase(),
        toSnake(value)
      ])
    );
  }

  return obj;
}

const example = {
  userId: 1,
  userName: "John Doe",
  userAge: 30,
  userAddress: {
    street: "123 Main St",
    city: "Anytown",
    state: "CA",
    iZip: "12345"
  }
};

