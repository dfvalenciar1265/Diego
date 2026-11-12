# Motor Docker para pruebas locales

Docker Desktop oficial 4.99.0 (Apple Silicon), firma Docker Inc verificada, motor29.9.3. Acuerdo aceptado tras confirmación de uso personal/empresa bajo umbrales gratuitos. Sin cuenta, plan pago ni configuración privilegiada. La instalación normal por CLI intentaba escribir en `/Library`; se completó inicio mediante la aplicación, sin elevar a administrador.

Supabase CLI3.1.0 ignoró el enlace por defecto de la red bridge. La primera ejecución se detuvo antes de fixtures. El adaptador `scripts/docker-loopback.py` usa el Docker oficial instalado y añade explícitamente `127.0.0.1` a cada publicación de puertos; rechaza otra dirección. No cambia cortafuegos ni configuración global.

Para repetir, copiar el adaptador como `docker` ejecutable a un directorio temporal y anteponer solo durante `supabase start` su directorio al PATH. No modificar el Docker real. Verificar `docker ps` antes de cargar fixtures:54321,54322,54324 deben mostrar127.0.0.1 y nunca0.0.0.0/[::]. No ejecutar contra proyectos enlazados. Guardar salida de inicio/status en archivo privado600 porque incluye claves del stack local; no imprimir, versionar ni adjuntar ese contenido.

El stack temporal de QA es independiente del proyecto remoto. Sus datos sintéticos y volúmenes se conservan al detenerlo; no borrar automáticamente. Después de pruebas detener únicamente ese stack mediante `supabase stop --workdir ...`. Mantener la app Docker instalada no implica que deba dejarse el motor consumiendo recursos indefinidamente.
