# Certification and licensing boundary

Ultimate TV OS has two distinct tracks.

## Engineering we control

We can build and test:

- host applications;
- virtualization;
- AOSP-derived TV system;
- Android compatibility work;
- virtual hardware;
- remote control support;
- input/audio/network/GPU integration;
- secure update system;
- security architecture;
- CTS/VTS automation;
- provider integration code once authorized SDKs are supplied.

## Approvals controlled by other companies

### Google

Potential requirements include Android compatibility, partner agreements, GMS licensing, Play Protect certification and separate eligibility for the Google TV experience.

The project must not redistribute proprietary Google packages without the appropriate license.

### Widevine

Production DRM integration can involve commercial agreements, approved libraries, device provisioning, security requirements and certification/testing.

Development success does not imply a production Widevine security level.

### Netflix and other streaming providers

Each provider can impose its own device, DRM, codec, output-protection, UX and QA requirements.

Passing Android compatibility or obtaining Google services does not automatically certify Netflix, Prime Video, Disney+ or other services.

### Dolby and other media technologies

Dolby Vision, Dolby Atmos and similar branded technologies may require separate licenses, implementation requirements and certification.

## Repository policy

Partner SDKs, signing material, DRM keys, provisioning secrets and confidential certification assets must never be committed to this public repository.
