import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Signup from "@/pages/Signup";

let authState: any = {
  signUp: vi.fn(async () => ({ error: null })),
  user: null,
  loading: true,
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe("Signup hook stability", () => {
  beforeEach(() => {
    authState = {
      signUp: vi.fn(async () => ({ error: null })),
      user: null,
      loading: true,
    };
  });

  it("does not crash when auth loading state changes", () => {
    const { rerender } = render(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>
    );

    authState = {
      ...authState,
      loading: false,
    };

    expect(() => {
      rerender(
        <MemoryRouter>
          <Signup />
        </MemoryRouter>
      );
    }).not.toThrow();
  });
});
