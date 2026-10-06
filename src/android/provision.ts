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
      args: ["shell", "settings", "put", "system", "peak_refresh_rate", "60.0"],
    },
    {
      args: ["shell", "settings", "put", "system", "min_refresh_rate", "60.0"],
    },
    {
      args: ["shell", "settings", "put", "system", "user_refresh_rate", "60"],
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

function sleepSync(milliseconds: number) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, milliseconds);
}

function runProvisionCommand(
  adbPath: string,
  serial: string,
  command: ProvisionCommand,
) {
  const attempts = command.required ? 6 : 2;
  let last = run(adbPath, ["-s", serial, ...command.args]);

  for (let attempt = 1; !last.ok && attempt < attempts; attempt += 1) {
    const transient =
      /closed|offline|device not found|no devices\/emulators/i.test(
        [last.stdout, last.stderr].join("\n"),
      );

    if (!transient && command.required) break;
    sleepSync(500);
    last = run(adbPath, ["-s", serial, ...command.args]);
  }

  return last;
}

export function provisionAndroidTvGuest(
  adbPath: string,
  serial: string,
): void {
  for (const command of guestProvisionCommands()) {
    const result = runProvisionCommand(
      adbPath,
      serial,
      command,
    );

    if (!result.ok && command.required) {
      throw new Error(
        result.stderr.trim() ||
          result.stdout.trim() ||
          "Unable to provision Google TV guest mode.",
      );
    }
  }
}
