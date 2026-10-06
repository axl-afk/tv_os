import { run } from "../lib/process.js";

export type ProvisionCommand = {
  args: string[];
  required?: boolean;
};

export function guestProvisionCommands(): ProvisionCommand[] {
  return [
    {
      args: ["shell", "settings", "put", "global", "device_provisioned", "1"],
      required: true,
    },
    {
      args: ["shell", "settings", "put", "secure", "user_setup_complete", "1"],
      required: true,
    },
    {
      args: ["shell", "settings", "put", "secure", "tv_user_setup_complete", "1"],
      required: true,
    },
    {
      args: ["shell", "settings", "put", "global", "setup_wizard_has_run", "1"],
    },
    {
      args: ["shell", "settings", "put", "system", "peak_refresh_rate", "120.0"],
    },
    {
      args: ["shell", "settings", "put", "system", "min_refresh_rate", "120.0"],
    },
    {
      args: ["shell", "settings", "put", "system", "user_refresh_rate", "120"],
    },
    {
      args: [
        "shell",
        "am",
        "start",
        "-a",
        "android.intent.action.MAIN",
        "-c",
        "android.intent.category.HOME",
      ],
      required: true,
    },
  ];
}

export function provisionAndroidTvGuest(
  adbPath: string,
  serial: string,
): void {
  for (const command of guestProvisionCommands()) {
    const result = run(adbPath, ["-s", serial, ...command.args]);
    if (!result.ok && command.required) {
      throw new Error(
        result.stderr.trim() ||
          "Unable to provision Google TV guest mode.",
      );
    }
  }
}
