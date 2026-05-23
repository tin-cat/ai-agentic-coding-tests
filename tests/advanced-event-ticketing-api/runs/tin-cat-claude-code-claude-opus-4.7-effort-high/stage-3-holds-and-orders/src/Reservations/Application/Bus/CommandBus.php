<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Application\Bus;

/**
 * Port for dispatching reservation commands. Mirrors the Catalog context's
 * shape so each bounded context owns its own bus contract rather than
 * sharing one across module boundaries.
 */
interface CommandBus
{
	/**
	 * @return mixed result returned by the handler, if any (e.g. the id of a
	 *               freshly-placed hold).
	 */
	public function dispatch(object $command): mixed;
}
