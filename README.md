# MoyenneED Desktop

A desktop application to compute your real EcoleDirecte average on PC.

All existing MoyenneED apps are mobile-only (Android / iOS). MoyenneED Desktop
brings the same idea to Windows: it connects to EcoleDirecte, fetches your
grades, and computes your average using the exact EcoleDirecte rules.

## Features

- Secure EcoleDirecte login, including QCM two-factor authentication.
- General average weighted by subject coefficients, matching EcoleDirecte.
- Class average and the gap with your own average.
- Per-subject grade breakdown (coefficient, class average).
- Edit a grade: change its value, its coefficient, or exclude it.
- Exclude a whole subject from the average in one click.
- Simulated grades to anticipate your average.
- Interactive evolution chart comparing your average with the class.
- Subject search and sorting.
- Automatic selection of the current term.
- Encrypted data stored locally on your machine.

## Requirements

- Windows 10 or 11 (64-bit).
- An EcoleDirecte account.
- An internet connection (the app queries the EcoleDirecte API).

No runtime to install: the app is fully self-contained (no .NET, no Java).

## Run from source

```bash
npm install
npm start
```

## Build

```bash
npm run build:win
```

The portable build is generated in `dist/win-unpacked/`. Copy the whole folder
and run `MoyenneED Desktop.exe`; no installation is required.

## Data location

User data (encrypted session and preferences) is stored in:

```
%LOCALAPPDATA%\MoyenneEDdesktop
```

## Privacy

Your credentials never leave your computer. They are stored encrypted using the
operating system secure storage and are only used to authenticate against the
EcoleDirecte API.

## License

Copyright (c) 2026 dev-zsm. All Rights Reserved. See [LICENSE.md](LICENSE.md).

MoyenneED Desktop is an independent project, not affiliated with EcoleDirecte.

## Author

dev-zsm — https://github.com/dev-zsm
