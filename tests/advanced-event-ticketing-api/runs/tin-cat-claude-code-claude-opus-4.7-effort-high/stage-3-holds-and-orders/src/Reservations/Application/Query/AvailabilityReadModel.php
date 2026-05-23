<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Application\Query;

use Frontstage\Reservations\Application\Query\View\EventAvailabilityView;

/**
 * Read-side port for "what is available for this event right now". The query
 * answer reflects both the source-of-truth seat status (Sold / Available in
 * the catalog) and the time-limited holds living in Redis, but it is built
 * separately from any write-side aggregate so the read path is free to
 * denormalize and cache as needed.
 */
interface AvailabilityReadModel
{
	public function forEvent(string $eventId): ?EventAvailabilityView;
}
