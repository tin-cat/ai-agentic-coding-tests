<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Event;

enum EventStatus: string
{
	case Draft = 'draft';
	case Published = 'published';
}
