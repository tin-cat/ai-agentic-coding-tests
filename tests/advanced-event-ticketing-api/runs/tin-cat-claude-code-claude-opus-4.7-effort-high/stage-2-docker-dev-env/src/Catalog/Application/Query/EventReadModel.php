<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Application\Query;

use Frontstage\Catalog\Application\Query\View\EventDetailView;
use Frontstage\Catalog\Application\Query\View\EventSummaryView;
use Frontstage\Catalog\Domain\Model\Event\EventId;

/**
 * Port for catalog read models. Queries skip the aggregate and read denormalized
 * shapes (views) tailored for API responses. Implementations live in the
 * infrastructure layer and typically use Doctrine DBAL directly.
 */
interface EventReadModel
{
	public function findDetailById(EventId $id): ?EventDetailView;

	/**
	 * @return list<EventSummaryView>
	 */
	public function listPublished(): array;
}
