# Icinga

Lleve su supervisión [Icinga 2](https://icinga.com/) a Gladys: cada host se
convierte en un dispositivo (activo, servicios WARNING, CRITICAL y UNKNOWN,
problemas sin gestionar, reconocido, mantenimiento), un dispositivo «Icinga»
lo resume todo, y sus escenas reaccionan cuando un host cae o un servicio
falla: una luz roja cuando el NAS está caído, un mensaje cuando una copia de
seguridad está en CRITICAL. Una escena también puede reconocer los problemas
de un host, y un widget del panel lista los problemas en curso.

La integración lee la API REST de Icinga 2 (puerto 5665) en su red local, con
un usuario de API. Nada pasa por una nube.

Probado con un Icinga 2.16 real (imagen Docker oficial `icinga/icinga2`,
checks `dummy` forzados a WARNING, CRITICAL y UNKNOWN, un host DOWN, un host
UNREACHABLE detrás de él, un mantenimiento, un reconocimiento, un host nunca
comprobado). Sus comentarios son bienvenidos:
[github.com/guim31/gladys-icinga/issues](https://github.com/guim31/gladys-icinga/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- Icinga 2 con su API REST activada (`icinga2 api setup`, que hacen la mayoría
  de las instalaciones y la imagen Docker oficial), accesible desde la máquina
  de Gladys en el puerto 5665. Icinga Web e Icinga DB no son necesarios.
- Un usuario de API para Gladys (un objeto `ApiUser`), solo con los permisos
  necesarios.

## Primeros pasos

### 1. Cree un usuario de API

En el servidor Icinga 2, añada en `/etc/icinga2/conf.d/api-users.conf` (o en
cualquier otro archivo de configuración):

```
object ApiUser "gladys" {
  password = "una-contrasena-larga-y-aleatoria"
  permissions = [
    "objects/query/Host",
    "objects/query/Service",
    "status/query",
    "actions/acknowledge-problem",
  ]
}
```

`status/query` solo sirve para la versión que muestra «Probar la conexión»:
puede omitirse. Omita `actions/acknowledge-problem` si Gladys no debe
reconocer nunca. Compruebe y recargue: `icinga2 daemon -C` y
`systemctl reload icinga2`. No utilice el usuario `root` de
`icinga2 api setup`: puede hacerlo todo.

### 2. Configure la integración

En Gladys, abra la configuración de la integración:

- **Dirección**: la dirección del servidor Icinga 2, por ejemplo
  `192.168.1.2`. Se añaden `https://` y el puerto 5665 salvo que introduzca
  otros (por ejemplo `https://monitoring.example.com:443/icinga-api` detrás de
  un proxy inverso).
- **Usuario de API** y **Contraseña**: el usuario del paso 1.
- **Grupos de hosts (opcional)**: nombres de grupos de hosts separados por
  comas, por ejemplo `homelab, linux-servers`: se toma un host de uno de
  ellos. Vacío: todos los hosts que ve el usuario de API.
- **Intervalo de actualización**: de 30 segundos a 5 minutos (1 minuto por
  defecto).
- **Permitir reconocer desde escenas**: desmárquelo para desactivar la acción
  de reconocimiento.
- **Aceptar certificados autofirmados**: Icinga firma el certificado de su API
  con su propia autoridad de certificación, por eso está marcado por defecto.
  Desmárquelo solo si su certificado es de confianza (un proxy inverso con un
  certificado público).
- **Idioma de los nombres**: idioma de los nombres de las funciones y de los
  resultados de las escenas.

Guarde y luego haga clic en **Probar la conexión**: muestra la versión de
Icinga, el número de hosts, de hosts caídos y de servicios con problemas.

### 3. Añada los dispositivos

Abra la pestaña **Descubrir** de la integración y añada los hosts que desea
seguir, y el dispositivo «Icinga» si quiere los totales. Los desencadenantes
de escena funcionan para todos los hosts, añadidos a Gladys o no.

## Los dispositivos

Cada **host** (con su nombre visible en Icinga):

| Función                 | Valor                                                               |
| ----------------------- | ------------------------------------------------------------------- |
| Host UP                 | 1 UP, 0 DOWN o UNREACHABLE; vacío mientras el host está en PENDING  |
| Servicios WARNING       | número de servicios WARNING                                         |
| Servicios CRITICAL      | número de servicios CRITICAL                                        |
| Servicios UNKNOWN       | número de servicios UNKNOWN                                         |
| Problemas sin gestionar | problemas de host y de servicio ni reconocidos ni en mantenimiento  |
| Host reconocido         | 1 mientras el host está DOWN o UNREACHABLE y su problema reconocido |
| En mantenimiento        | 1 mientras el host está en un periodo de mantenimiento programado   |

El dispositivo **Icinga**: Hosts DOWN (DOWN o UNREACHABLE), Servicios WARNING,
Servicios CRITICAL, Servicios UNKNOWN y Problemas sin gestionar, sobre los
hosts de la configuración.

Un host está UNREACHABLE cuando está DOWN e Icinga sabe, por una dependencia,
que su padre también ha caído. Los números de servicios incluyen los estados
que Icinga todavía está confirmando (SOFT), como los muestra Icinga Web. Los
valores se envían a Gladys solo cuando cambian, y si no, cada 6 horas.

## Panel

El widget **Problemas de Icinga** muestra tres casillas («Hosts DOWN»,
«Servicios CRITICAL», «Sin gestionar») y los problemas: hosts DOWN, luego
UNREACHABLE, luego servicios CRITICAL, UNKNOWN y WARNING, los más recientes
primero. Cada fila indica el servicio y su estado, el host, ✓ una vez
reconocido y ⏸ en mantenimiento. Diez filas como máximo. **Actualizar** vuelve
a leer Icinga. En sus ajustes, elija hosts para mostrar solo los suyos (vacío:
todos los hosts).

## Escenas

### Desencadenantes

- **Un host cae**: un host pasa a DOWN o UNREACHABLE. Filtro: hosts (vacío:
  cualquiera). Variables: nombre del host, estado (DOWN, UNREACHABLE). Un host
  que pasa de DOWN a UNREACHABLE no se anuncia dos veces.
- **Un host vuelve**: un host anunciado como caído vuelve a estar UP.
  Variables: nombre del host, duración en minutos.
- **Un servicio tiene un problema**: un servicio entra en WARNING, CRITICAL o
  UNKNOWN, o cambia entre ellos (de WARNING a CRITICAL, por ejemplo). Filtros:
  hosts, estados (vacío: cualquiera; para «solo CRITICAL», elija CRITICAL).
  Variables: nombre del host, servicio, estado, salida del check (su primera
  línea).
- **Un servicio vuelve a OK**: un servicio anunciado con problema vuelve a OK.
  Filtros: hosts, el último estado de problema anunciado. Variables: nombre del
  host, servicio, último estado de problema, duración en minutos.
- **Icinga ya no responde**: la API REST no responde dos veces seguidas
  (variables: dirección, error).

Los problemas ya presentes cuando arranca la integración no se anuncian, pero
su fin sí. Solo cuentan los estados confirmados (HARD): mientras Icinga repite
un check (estado SOFT, hasta `max_check_attempts`), no se anuncia nada, ya que
Icinga tampoco notifica. Un cambio que ocurre mientras Gladys o la integración
se reinicia se anuncia una vez en la siguiente lectura. Un problema en
mantenimiento (del servicio o de su host) no se anuncia; si sigue ahí cuando
termina el mantenimiento, se anuncia entonces.

### Acciones

- **Reconocer los problemas de un host**: reconoce en Icinga el problema del
  host (DOWN, UNREACHABLE) y cada uno de sus servicios con problemas aún no
  reconocidos, con un comentario (vacío: «Reconocido desde Gladys») y el autor
  «Gladys». El reconocimiento es persistente (hasta que el host esté UP o el
  servicio OK) y no envía ninguna notificación. Devuelve el número de
  reconocimientos. Desactívela con «Permitir reconocer desde escenas».
- **Leer los problemas**: cuenta y lista los problemas de un host, o de todos,
  para las acciones siguientes: número, sin gestionar, hosts caídos, servicios
  CRITICAL, WARNING y UNKNOWN, y la lista «host: problema».

### Ideas de escenas

- **Una luz roja cuando el NAS está caído**: desencadenante «Un host cae», host
  NAS → poner en rojo la lámpara del salón y enviar
  `{{triggerEvent.data.host}}: {{triggerEvent.data.state_name}}`.
- **Solo los servicios críticos**: desencadenante «Un servicio tiene un
  problema», estado CRITICAL → mensaje `{{triggerEvent.data.host}} /
{{triggerEvent.data.service}}: {{triggerEvent.data.output}}`.
- **Informe matutino**: todos los días a las 8:00, «Leer los problemas» →
  enviar el número y la lista cuando el número es mayor que 0.
- **Desde el sofá**: un botón del panel o un mando Zigbee ejecuta «Reconocer
  los problemas de un host» en el NAS.

## Solución de problemas

- **«usuario de API o contraseña rechazados»**: compruebe el objeto `ApiUser`,
  y que Icinga se haya recargado después de añadirlo.
- **«Icinga no responde»**: compruebe la dirección y el puerto 5665 desde la
  máquina de Gladys (un cortafuegos suele cerrarlo). `localhost` es el propio
  contenedor de la integración: utilice la dirección IP de la máquina de
  Icinga.
- **«no hay ninguna API de Icinga 2 en esta dirección»**: responde otra cosa
  (Icinga Web en el puerto 80 o 443, por ejemplo): utilice el puerto 5665.
- **«la API de Icinga solo habla HTTPS»**: introduzca `https://`, o nada
  delante de la dirección.
- **«falta un permiso del usuario de API»** o **«ningún host visible»**: añada
  los permisos del paso 1 al objeto `ApiUser` y recargue Icinga. Un permiso con
  `filter` también puede ocultar todos los hosts.
- **«certificado rechazado»**: marque «Aceptar certificados autofirmados».
- **Falta un host**: no está en ninguno de los grupos de hosts de la
  configuración.
- **Se rechaza el reconocimiento**: el usuario de API necesita el permiso
  `actions/acknowledge-problem`.

## Límites

- Una instancia de Icinga 2 por integración (en un clúster, la dirección de un
  master: ve todos los hosts de sus zonas).
- Solo estados de hosts y de servicios: sin métricas ni datos de rendimiento.
- La integración lee Icinga al intervalo elegido: un evento que aparece y
  desaparece entre dos lecturas se pierde. No se utiliza el flujo
  `/v1/events`.
- «Un servicio vuelve a OK» también se activa cuando un servicio con problemas
  se retira de la supervisión; un host retirado de Icinga o del alcance
  termina sin aviso.
- Como máximo 30 eventos de escena por lectura: un corte de red puede generar
  decenas a la vez; el resto sigue en las lecturas siguientes.
- Sin cuota en la API REST: cada lectura envía dos peticiones (tres una vez por
  hora, para la versión).

Sin relación con el proyecto Icinga ni con Icinga GmbH.
