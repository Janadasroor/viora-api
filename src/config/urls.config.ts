import "dotenv"
const BASE_URL = process.env.BASE_URL;
export function baseUrl() {
    return BASE_URL;
}

const mediaUrls ={
    imagesPath:"/images/",
    videosPath:"/videos/resolutions/",
    videosThumbnailPath:"/videos/thumbnails/",
    videosPreviewPath:"/videos/previews/",
    baseUrl:process.env.BASE_URL
}
export default mediaUrls