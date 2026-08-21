import { usePrimaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { VideoCameraIcon } from '@phosphor-icons/react'
import SidebarItem from './SidebarItem'

export default function VideoRoomsButton({ collapse }: { collapse: boolean }) {
  const { navigate, current, display } = usePrimaryPage()
  const { checkLogin } = useNostr()
  const active = display && current === 'videoRooms'

  return (
    <SidebarItem
      title="Video Rooms"
      onClick={() => checkLogin(() => navigate('videoRooms'))}
      active={active}
      collapse={collapse}
    >
      <VideoCameraIcon weight={active ? 'fill' : 'bold'} />
    </SidebarItem>
  )
}
